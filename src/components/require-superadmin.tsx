"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function RequireSuperadmin({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // read role from local storage-backed state you already hydrate (token/me)
    const raw = localStorage.getItem("role") || ""; // optional if you store role
    const roleFromStorage = raw.toLowerCase();

    // fallback: parse from JWT if you don’t persist role
    const token = localStorage.getItem("token");
    const claims = token ? JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) : {};
    const role =
      roleFromStorage ||
      (claims?.role || (Array.isArray(claims?.roles) ? claims.roles[0] : ""))?.toLowerCase() ||
      "";

    if (role !== "superadmin") {
      router.replace("/dashboard"); // bounce non-superusers
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;
  return <>{children}</>;
}