"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";

import { logout } from "@/lib/auth";

function IdleLogout() {
  const router = useRouter();
  const timeoutRef = useRef<number | null>(null);
  const IDLE_MINUTES = 30; // adjust as needed

  useEffect(() => {
    const reset = () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        try {
          logout();
          sessionStorage.clear();
        } catch {}
        router.replace("/login?reason=expired");
      }, IDLE_MINUTES * 60 * 1000);
    };

    const events = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "visibilitychange",
    ];
    events.forEach((evt) => window.addEventListener(evt, reset));
    reset();

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, reset));
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [router]);

  return null;
}

export default function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={qc}>
      <IdleLogout />
      {children}
    </QueryClientProvider>
  );
}
