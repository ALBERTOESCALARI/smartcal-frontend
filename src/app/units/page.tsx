"use client";

import RequireAuth from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { createUnit, deleteUnit, fetchUnits, type Unit } from "@/features/units/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSession } from "../../features/auth/useSession";

function parseJwt<T = Record<string, unknown>>(token: string | null): T | null {
  try {
    if (!token) return null;
    const part = token.split(".")[1];
    const json = typeof window !== "undefined"
      ? atob(part.replace(/-/g, "+").replace(/_/g, "/"))
      : Buffer.from(part, "base64").toString();
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// Consistent error extractor
const getErrMsg = (err: unknown): string => {
  if (!err) return "Request failed";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "Request failed";

  if (typeof err === "object") {
    const maybe = err as {
      response?: { data?: { detail?: string } | string };
      message?: string;
    };
    const data = maybe.response?.data;
    const detail = typeof data === "string" ? data : data?.detail;
    if (detail) return detail;
    if (maybe.message) return maybe.message;
    if (data) {
      try {
        return JSON.stringify(data);
      } catch {
        return String(data);
      }
    }
  }

  return "Request failed";
};

function formatError(err: unknown): string {
  return getErrMsg(err);
}

export default function UnitsPage() {
  const [tenantId, setTenantId] = useState("");
  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("tenant_id") : null;
    if (t) setTenantId(t);
  }, []);

  const { data, isLoading, error } = useQuery<Unit[]>({
    queryKey: ["units", tenantId],
    queryFn: () => fetchUnits(tenantId),
    enabled: Boolean(tenantId),
    retry: false,
  });

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sessionUser } = useSession();
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  interface TokenClaims {
    role?: string;
    roles?: string[];
  }

  const claims = parseJwt<TokenClaims>(token);
  const tokenRole =
    typeof claims?.role === "string"
      ? claims.role
      : Array.isArray(claims?.roles)
      ? claims.roles[0]
      : undefined;

  const [roleFromMe, setRoleFromMe] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function ensureRole() {
      if (sessionUser?.role || tokenRole) return; // already have a role
      try {
        const base = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
        const url = base ? `${base}/auth/me` : "/auth/me";
        const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(url, { credentials: "include", headers });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRoleFromMe((data?.role || data?.user?.role || "").toString().toLowerCase() || null);
      } catch {}
    }
    ensureRole();
    return () => { cancelled = true; };
  }, [sessionUser?.role, tokenRole]);

  const role = (sessionUser?.role || tokenRole || roleFromMe || "member").toString().toLowerCase();
  const isAdmin = role === "admin";
  console.log("UnitsPage detected role:", role);

  const mutation = useMutation<Unit, unknown, { name: string}>({
    mutationFn: (payload: { name: string }) => {
      if (!tenantId) throw new Error("Missing tenantId");
      return createUnit(tenantId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["units", tenantId] });
      toast({
        title: "Unit created",
        description: `Unit "${name}" was successfully created.`,
      });
      setName("");
      setNameError("");
    },
    onError: (error: unknown) => {
      toast({ title: "Error", description: formatError(error) });
    },
  });

  const delMut = useMutation<string, unknown, string>({
    mutationFn: (id: string) => deleteUnit(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["units", tenantId] });
      toast({ title: "Unit deleted", description: "The unit was removed." });
    },
    onError: (error: unknown) => {
      toast({ title: "Delete failed", description: formatError(error) });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3) {
      setNameError("Name must be at least 3 characters long.");
      return;
    }
    setNameError("");
    mutation.mutate({ name: name.trim() });
  }

  return (
    <RequireAuth>
        <Card className="p-4 mb-4 bg-muted/50">
          <div className="mb-2 font-medium">Tenant</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = tenantId.trim();
              if (!value) return;
              localStorage.setItem("tenant_id", value);
              queryClient.invalidateQueries({ queryKey: ["units", value] });
              toast({ title: "Tenant set", description: `Using tenant ${value}` });
            }}
            className="flex gap-2"
          >
            <Input
              placeholder="Tenant ID (UUID)"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            />
            <Button type="submit" variant="outline">Save</Button>
          </form>
          {!tenantId && (
            <p className="mt-2 text-sm text-muted-foreground">Paste your tenant UUID and click Save to load units.</p>
          )}
        </Card>

        {isAdmin && (
          <Card className="p-4 mb-4 bg-muted/50">
            <form onSubmit={handleSubmit} className="flex flex-col space-y-2">
              <Input
                placeholder="New unit name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!nameError}
                aria-describedby="name-error"
              />
              {nameError && (
                <p id="name-error" className="text-sm text-red-600">
                  {nameError}
                </p>
              )}
              <Button type="submit" disabled={mutation.isPending} variant="default">
                {mutation.isPending ? "Adding…" : "Add Unit"}
              </Button>
            </form>
          </Card>
        )}

        <Card className="p-4 bg-muted/30">
          <div className="mb-3 font-medium">Units</div>

          {!tenantId && (
            <div className="text-sm text-muted-foreground">Set a Tenant ID above to load units.</div>
          )}

          {isLoading && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}

          {error && (
            <div className="text-sm text-red-600">{formatError(error)}</div>
          )}

          {data && data.length === 0 && (
            <div className="text-sm text-muted-foreground">No units yet.</div>
          )}

          {data && data.length > 0 && (
            <ul className="text-sm space-y-2">
              {data.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between border rounded-md px-3 py-2 hover:bg-muted/50 transition"
                >
                  <span>{u.name}</span>
                  <div className="flex items-center gap-2">
                    <code className="opacity-60">{String(u.id).slice(0, 8)}…</code>
                    {isAdmin && (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={delMut.isPending}
                        onClick={() => {
                          if (!confirm(`Delete unit \"${u.name}\"?`)) return;
                          delMut.mutate(u.id);
                        }}
                      >
                        {delMut.isPending ? "Deleting…" : "Delete"}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
    </RequireAuth>
  );
}
