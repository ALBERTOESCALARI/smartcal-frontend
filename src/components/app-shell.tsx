"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import TenantSwitcher from "@/components/TenantSwitcher";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/use-toast";
import { logout } from "@/lib/auth";
import { cn } from "@/lib/utils";

// --- Navigation config -------------------------------------------------------
type NavItem = { href: string; label: string; role?: "admin" | "member" | "all" };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", role: "all" },
  { href: "/shifts", label: "Calendar", role: "all" },
  { href: "/clock", label: "Clock In/Out", role: "all" },
  { href: "/requests/pto", label: "PTO Requests", role: "all" },
  { href: "/requests/swaps", label: "Shift Swaps", role: "all" },
  { href: "/hours", label: "Hours", role: "admin" },
  { href: "/units", label: "Units", role: "admin" },
  { href: "/users", label: "Users", role: "admin" },
];

// Small helper so nested routes (e.g. /units/123) are also highlighted
function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

function parseJwt<T = Record<string, unknown>>(token: string | null): T | null {
  try {
    if (!token) return null;
    const base = token.split(".")[1];
    const json =
      typeof window !== "undefined"
        ? atob(base.replace(/-/g, "+").replace(/_/g, "/"))
        : Buffer.from(base, "base64").toString();
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");

interface AppShellProps {
  readonly children: ReactNode;
}

interface MeUser {
  id?: string;
  email: string;
  role?: string;
  name?: string;
  employee_id?: string;
}

type TokenClaims = {
  id?: string;
  user_id?: string;
  uid?: string;
  sub?: string;
  email?: string;
  role?: string;
  roles?: string[];
  name?: string;
  employee_id?: string;
  emp_id?: string;
  tenant_id?: string;
  tenant?: string;
  org_id?: string;
  organization_id?: string;
  [key: string]: unknown;
};

type MeResponse = {
  id?: string;
  email?: string;
  name?: string;
  employee_id?: string;
  role?: string;
  tenant_id?: string;
  tenant?: { id?: string } | null;
  tenants?: Array<{ id?: string } | null>;
  user?: {
    id?: string;
    email?: string;
    role?: string;
    name?: string;
    employee_id?: string;
    tenant_id?: string;
  } | null;
};

export default function AppShell({ children }: Readonly<AppShellProps>) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);

  // Resolve auth state on client only to avoid hydration mismatch
  const [mounted, setMounted] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState<MeUser | null>(null);
  const [loadingMe, setLoadingMe] = useState(false);
  const [tokenUser, setTokenUser] = useState<Partial<MeUser> | null>(null);

  // Timeout fallback for slow auth
  const [timedOut, setTimedOut] = useState(false);

  // Inline login form state for timeout screen
  const [tEmail, setTEmail] = useState("");
  const [tPw, setTPw] = useState("");
  const [tBusy, setTBusy] = useState(false);
  const [tErr, setTErr] = useState<string | null>(null);

  // Persist tenant_id only once (first time it’s discovered/selected)
  function setTenantIdOnce(id?: string | null) {
    if (!id) return;
    try {
      const existing = localStorage.getItem("tenant_id");
      if (!existing) localStorage.setItem("tenant_id", id);
    } catch {}
  }

  // Initial token parsing (no auth granted here)
  useEffect(() => {
    setMounted(true);
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    // ⚠️ Do NOT set authed here; wait for /auth/me success
    const claims = parseJwt<TokenClaims>(token);
    if (claims) {
      const emailFromToken =
        typeof claims.email === "string" && claims.email.includes("@")
          ? claims.email
          : "";

      setTokenUser({
        id: claims.id || claims.user_id || claims.uid || claims.sub || undefined,
        email: emailFromToken,
        role: claims.role || (Array.isArray(claims.roles) ? claims.roles[0] : undefined),
        name: typeof claims.name === "string" ? claims.name : undefined,
        employee_id: claims.employee_id || claims.emp_id || undefined,
      });

      // If the token carries a tenant id, lock it in once
      const tenantFromClaims =
        (typeof claims.tenant_id === "string" && claims.tenant_id) ||
        (typeof claims.tenant === "string" && claims.tenant) ||
        (typeof claims.org_id === "string" && claims.org_id) ||
        (typeof claims.organization_id === "string" && claims.organization_id) ||
        null;
      if (tenantFromClaims) setTenantIdOnce(String(tenantFromClaims));
    } else {
      setTokenUser(null);
    }
  }, [pathname]);

  // Server-confirmed auth state via /auth/me
  useEffect(() => {
    if (!mounted) return;
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    setLoadingMe(true);
    const meUrl = API_BASE ? `${API_BASE}/auth/me` : "/auth/me";
    const loadMe = async () => {
      try {
        const response = await fetch(meUrl, {
          headers,
          credentials: "include",
        });
        if (!response.ok) {
          // Backend said no; ensure authed is false
          setMe(null);
          setAuthed(false);
          throw new Error(await response.text());
        }
        const data: MeResponse = await response.json();

        if (data?.user?.email) {
          const mePayload: MeUser = {
            id: data.user.id ?? data.id,
            email: data.user.email,
            name: data.name ?? data.user.name ?? undefined,
            employee_id: data.employee_id ?? data.user.employee_id ?? undefined,
            role: data.role ?? data.user.role ?? undefined,
          };
          setMe(mePayload);
          setAuthed(true);

          const tenantCandidates = [
            data.tenant_id,
            data.user.tenant_id,
            data.tenant?.id,
            Array.isArray(data.tenants) && data.tenants.length === 1 ? data.tenants[0]?.id : undefined,
          ].filter(
            (candidate): candidate is string =>
              typeof candidate === "string" && candidate.length > 0
          );

          if (tenantCandidates.length > 0) {
            setTenantIdOnce(tenantCandidates[0]);
          }
        } else {
          setMe(null);
          setAuthed(false);
        }
      } catch {
        setMe(null);
        setAuthed(false);
      } finally {
        setLoadingMe(false);
      }
    };

    void loadMe();
  }, [mounted, pathname]);

  // Show minimal screen if auth is slow or if user is unauthenticated for a while
  useEffect(() => {
    const ms = 5000; // 5s

    // Never show timeout overlay on explicit auth pages
    if (pathname === "/login") {
      setTimedOut(false);
      return;
    }

    // Immediately show splash when not authenticated
    if (!authed) {
      setTimedOut(true);
      return;
    }

    // Otherwise, if auth is still loading, arm the slow-auth timer
    if (loadingMe) {
      const id = setTimeout(() => setTimedOut(true), ms);
      return () => clearTimeout(id);
    }

    // If authenticated and not loading, ensure splash is hidden
    setTimedOut(false);
  }, [authed, loadingMe, pathname]);

  const handleLogout = useCallback(() => {
    logout();
    setAuthed(false);
    setTimedOut(true);
    toast({ title: "Signed out", description: "You have been logged out." });
    router.replace("/login");
  }, [router, toast]);

  const role = (me?.role || tokenUser?.role || "member").toLowerCase();
  const isAdmin = role === "admin";

  const NavList = useMemo(
    () => (
      <nav className="flex flex-col gap-2">
        {NAV.map((n) => {
          if (n.role === "admin" && !isAdmin) return null;
          const active = isActive(pathname, n.href);
          return (
            <Button
              key={n.href}
              asChild
              variant={active ? "default" : "outline"}
              size="sm"
              className={cn("justify-start w-full", active && "font-medium")}
              onClick={() => setOpen(false)}
            >
              <Link href={n.href} aria-current={active ? "page" : undefined} className="w-full text-left font-semibold">
                {n.label}
              </Link>
            </Button>
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
            <Button variant="outline" size="sm" className="font-semibold">Shifts</Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handleLogout} className="font-semibold">
            Logout
          </Button>
        </div>
      );
    }
    return (
      <Button variant="outline" size="sm" className="font-semibold" onClick={() => router.push('/login')}>
        Login
      </Button>
    );
  }, [mounted, authed, handleLogout, router]);

  if (timedOut && pathname !== "/login") {
    return (
      <div className="min-h-screen w-screen fixed inset-0 z-[9999] flex items-center justify-center bg-gray-100 dark:bg-neutral-950 text-slate-900 dark:text-neutral-100 p-6">
        <div className="flex flex-col items-center gap-6">
          <Image
            src="/smartcal-logo.png"
            alt="SmartCal Logo"
            height={192}
            width={192}
            className="h-48 w-48 rounded-md bg-white ring-1 ring-slate-200 p-1 dark:bg-neutral-900 dark:ring-neutral-700"
            priority
          />
          <div className="text-2xl font-semibold">SmartCal</div>
          <div className="text-sm text-muted-foreground text-center max-w-sm">
            Connection timed out. Please sign in to continue.
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                setTErr(null);
                setTBusy(true);
                const body = new URLSearchParams();
                body.set("username", tEmail.trim());
                body.set("password", tPw);
                const tokenUrl = API_BASE ? `${API_BASE}/auth/token` : "/auth/token";
                const resp = await fetch(tokenUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body,
                  credentials: "include",
                });
                if (!resp.ok) {
                  let msg = "Login failed";
                  try {
                    const data = await resp.json();
                    msg = (typeof data?.detail === "string" && data.detail) || msg;
                  } catch {
                    const text = await resp.text();
                    if (text) msg = text;
                  }
                  if (resp.status === 401) msg = "Invalid email or password";
                  if (resp.status === 404) msg = "Auth service not found at /auth/token";
                  throw new Error(msg);
                }
                const json = await resp.json();
                if (!json?.access_token) throw new Error("No access token returned");
                localStorage.setItem("token", json.access_token);
                setTimedOut(false);
                setAuthed(true);
                setTBusy(false);
                router.replace("/dashboard");
              } catch (err: any) {
                setTBusy(false);
                setTErr(err?.message || "Unable to sign in");
              }
            }}
            className="w-full max-w-sm grid gap-3"
          >
            <div className="grid gap-1">
              <label htmlFor="to-email" className="text-sm font-medium">Email</label>
              <input
                id="to-email"
                type="email"
                value={tEmail}
                onChange={(e) => setTEmail(e.target.value)}
                required
                autoComplete="username"
                className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="you@example.com"
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="to-pw" className="text-sm font-medium">Password</label>
              <input
                id="to-pw"
                type="password"
                value={tPw}
                onChange={(e) => setTPw(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="••••••••"
              />
            </div>
            {tErr ? <div className="text-sm text-red-600">{tErr}</div> : null}
            <Button type="submit" size="sm" className="font-semibold" disabled={tBusy}>
              {tBusy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // Compute layout classes: with sidebar when authed; single column when not.
  const gridClass = authed
    ? "mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[220px_1fr]"
    : "mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:inset-x-0 focus:top-2 focus:m-2 focus:rounded focus:bg-muted focus:px-3 focus:py-2">
          Skip to content
        </a>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Mobile nav (only when authenticated) */}
            {authed ? (
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
            ) : null}

            <Link href="/dashboard" className="flex items-center gap-2 text-lg font-semibold">
              <Image
                src="/smartcal-logo.png"
                alt="SmartCal Logo"
                className="h-24 w-24 rounded-md bg-white ring-1 ring-slate-200 p-0.5 dark:bg-neutral-900 dark:ring-neutral-700"
                height={96}
                width={96}
                priority
              />
            </Link>

            {/* Identity text (only when authenticated) */}
            {authed && identityText ? (
              <span className="text-sm text-green-600 ml-4">
                Signed in as: {identityText}
              </span>
            ) : null}
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
          {me?.role === "superadmin" ? <TenantSwitcher /> : null}
          {RightActions}
        </div>
        </div>
      </header>

      {/* Main grid */}
      <div className={gridClass}>
        {/* Sidebar (desktop) - only when authenticated */}
        {authed ? (
          <aside className="block">
            <div className="sticky top-16">{NavList}</div>
          </aside>
        ) : null}

        {/* Content */}
        <main id="content">{children}</main>
      </div>
    </div>
  );
}