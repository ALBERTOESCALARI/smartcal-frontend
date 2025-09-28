


"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function SplashScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-6">
        <img src="/smartcal-logo.png" alt="SmartCal" className="h-24 w-24" />
        <a href="/login" className="px-4 py-2 rounded bg-black text-white font-medium">
          Sign in
        </a>
        <p className="text-sm text-slate-500">Session expired. Please sign in.</p>
      </div>
    </div>
  );
}

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const check = () => {
      const token = localStorage.getItem("token");
      if (!token) {
        router.replace("/login?reason=expired");
      } else {
        setReady(true);
      }
    };

    check();

    // react to token being cleared in another tab or by interceptors
    const onStorage = (e: StorageEvent) => {
      if (e.key === "token" && e.newValue == null) {
        router.replace("/login?reason=expired");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [router]);

  if (!ready) return <SplashScreen />;
  return <>{children}</>;
}