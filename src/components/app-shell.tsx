"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";
import { logout } from "@/lib/auth";
import { cn } from "@/lib/utils";

// --- Navigation config -------------------------------------------------------
const NAV: { href: string; label: string }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/shifts", label: "Calendar" },
  { href: "/requests/pto", label: "PTO Requests" },
  { href: "/requests/swaps", label: "Shift Swaps" },
  { href: "/units", label: "Units" },
  { href: "/users", label: "Users" },
];

// Small helper so nested routes (e.g. /units/123) are also highlighted
function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

function parseJwt<T = any>(token: string | null): T | null {
  try {
    if (!token) return null;
    const base = token.split(".")[1];
    const json = typeof window !== "undefined" ? atob(base.replace(/-/g, "+").replace(/_/g, "/")) : Buffer.from(base, "base64").toString();
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");

interface AppShellProps {
  children: ReactNode;
}

interface MeUser {
  id?: string;
  email: string;
  role?: string;
  name?: string;
  employee_id?: string;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);

  // Resolve auth state on client only to avoid hydration mismatch
  const [mounted, setMounted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState<MeUser | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [tokenUser, setTokenUser] = useState<Partial<MeUser> | null>(null);

  // Persist tenant_id only once (first time it’s discovered/selected)
  function setTenantIdOnce(id?: string | null) {
    if (!id) return;
    try {
      const existing = localStorage.getItem("tenant_id");
      if (!existing) localStorage.setItem("tenant_id", id);
    } catch {}
  }

  useEffect(() => {
    setMounted(true);
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    setAuthed(Boolean(token));
    const claims = parseJwt<any>(token);
    if (claims) {
      const emailFromToken =
        typeof claims.email === "string" && claims.email.includes("@")
          ? claims.email
          : ""; // don't use `sub` as email; many providers set it to a UUID

      setTokenUser({
        id: claims.id || claims.user_id || claims.uid || claims.sub || undefined,
        email: emailFromToken,
        role: claims.role || (Array.isArray(claims.roles) ? claims.roles[0] : undefined),
        name: typeof claims.name === "string" ? claims.name : undefined,
        employee_id: claims.employee_id || claims.emp_id || undefined,
      });

      // If the token carries a tenant id, lock it in once
      const tenantFromClaims = claims.tenant_id || claims.tenant || claims.org_id || claims.organization_id;
      if (tenantFromClaims) setTenantIdOnce(String(tenantFromClaims));
    } else {
      setTokenUser(null);
    }
  }, [pathname]);

  useEffect(() => {
    if (!mounted) return;
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    setLoadingMe(true);
    const meUrl = API_BASE ? `${API_BASE}/auth/me` : "/auth/me";
    fetch(meUrl, {
      headers,
      credentials: "include",
    })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.text())))
      .then((data) => {
        if (data?.user) {
          setMe({
            ...data.user,
            name: data.name ?? data.user.name,
            employee_id: data.employee_id ?? (data.user as any)?.employee_id,
            role: (data as any)?.role ?? (data.user as any)?.role,
          });
          setAuthed(true);

          // Derive tenant id from /auth/me (first one wins)
          const t1 = (data as any)?.tenant_id;
          const t2 = (data?.user as any)?.tenant_id;
          const t3 = (data as any)?.tenant?.id;
          const t4 = Array.isArray((data as any)?.tenants) && (data as any).tenants.length === 1 ? (data as any).tenants[0]?.id : undefined;
          setTenantIdOnce(t1 || t2 || t3 || t4 || null);
        } else {
          setMe(null);
          setAuthed(Boolean(token));
        }
      })
      .catch(() => {
        setMe(null);
        setAuthed(Boolean(token));
      })
      .finally(() => setLoadingMe(false));
  }, [mounted, pathname]);

  const handleLogout = useCallback(() => {
    logout();
    setAuthed(false);
    toast({ title: "Signed out", description: "You have been logged out." });
    router.replace("/login");
  }, [router, toast]);

  const role = (me?.role || tokenUser?.role || "member").toLowerCase();
  const isAdmin = role === "admin";

  const NavList = useMemo(
    () => (
      <nav className="flex flex-col gap-1">
        {NAV.map((n) => {
          if (n.href === "/users" && !isAdmin) return null; // hide Users for members
          const active = isActive(pathname, n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-xl px-3 py-2 text-sm hover:bg-muted",
                active && "bg-muted font-medium"
              )}
              onClick={() => setOpen(false)}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>
    ),
    [pathname, isAdmin]
  );

  const identityText = useMemo(() => {
    const src = me || tokenUser;
    if (!src) return "";
    const parts: string[] = [];
    if (src.name) parts.push(src.name);
    if (src.employee_id) parts.push(`ID: ${src.employee_id}`);
    if (src.email) parts.push(src.email);
    if (src.role) parts.push(src.role.toLowerCase());
    return parts.join(" • ");
  }, [me, tokenUser]);

  const RightActions = useMemo(() => {
    if (!mounted) return null;
    if (authed) {
      return (
        <div className="flex items-center gap-2">
          <Link href="/shifts">
            <Button variant="outline" size="sm">Shifts</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      );
    }
    return (
      <Link href="/login">
        <Button variant="outline" size="sm">Login</Button>
      </Link>
    );
  }, [mounted, authed, handleLogout]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:inset-x-0 focus:top-2 focus:m-2 focus:rounded focus:bg-muted focus:px-3 focus:py-2">
          Skip to content
        </a>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Mobile nav */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="md:hidden" aria-label="Open navigation">
                  Menu
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64" aria-label="Sidebar navigation">
                <div className="mt-8">{NavList}</div>
              </SheetContent>
            </Sheet>

            <Link href="/dashboard" className="text-lg font-semibold">
              SmartCal
            </Link>
            {(loadingMe || identityText) && (
              <span className="text-sm text-green-600 ml-4">
                Signed in as: {identityText || "…"}
              </span>
            )}
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            {RightActions}
          </div>
        </div>
      </header>

      {/* Main grid */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[220px_1fr]">
        {/* Sidebar (desktop) */}
        <aside className="block">
          <div className="sticky top-16">{NavList}</div>
        </aside>

        {/* Content */}
        <main id="content">{children}</main>
      </div>
    </div>
  );
}