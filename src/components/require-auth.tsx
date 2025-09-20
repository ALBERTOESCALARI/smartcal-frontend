

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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

  if (!ready) return null;
  return <>{children}</>;
}