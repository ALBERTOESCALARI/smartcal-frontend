"use client";

import Image from "next/image";
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
  { href: "/hours", label: "Hours" },
  { href: "/units", label: "Units" },
  { href: "/users", label: "Users" },
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

export default function AppShell({ children }: AppShellProps) {
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
    const claims = parseJwt<TokenClaims>(token);
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
          ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

          if (tenantCandidates.length > 0) {
            setTenantIdOnce(tenantCandidates[0]);
          }
        } else {
          setMe(null);
          setAuthed(Boolean(token));
        }
      } catch {
        setMe(null);
        setAuthed(Boolean(token));
      } finally {
        setLoadingMe(false);
      }
    };

    void loadMe();
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
      <nav className="flex flex-col gap-2">
        {NAV.map((n) => {
          if (n.href === "/users" && !isAdmin) return null; // hide Users for members
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
      <Link href="/login">
        <Button variant="outline" size="sm" className="font-semibold">Login</Button>
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

            <Link href="/dashboard" className="flex items-center gap-2 text-lg font-semibold">
              <Image
                src="/smartcal-logo.png"
                alt="SmartCal Logo"
                className="h-6 w-6"
                height={24}
                width={24}
                priority
              />
              <span>SmartCal</span>
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
