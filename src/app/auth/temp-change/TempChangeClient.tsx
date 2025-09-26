"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changeUserPassword } from "@/features/users/api";
import {
  getActiveTenantId,
  setActiveTenantId,
  loadSessionUser,
} from "@/lib/api";

function getPendingTemp(): { value: string; issuedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("pending_temp_password");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: string; issuedAt?: number };
    if (!parsed?.value || typeof parsed.issuedAt !== "number") return null;
    return { value: parsed.value, issuedAt: parsed.issuedAt };
  } catch {
    return null;
  }
}

async function fetchMe(): Promise<{
  id: string | null;
  tenant_id: string | null;
}> {
  if (typeof window === "undefined") return { id: null, tenant_id: null };
  const token = localStorage.getItem("token");
  if (!token) return { id: null, tenant_id: null };

  const envBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE ||
    "";
  const base = envBase.replace(/\/+$/, "");
  const url = base ? `${base}/auth/me` : "/auth/me";

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error("Failed to load account info");
  }
  const data = await res.json();
  const id = data?.id ?? data?.user?.id ?? data?.user_id ?? null;
  const tenant =
    data?.tenant_id ??
    data?.user?.tenant_id ??
    data?.memberships?.[0]?.tenant_id ??
    null;
  return { id, tenant_id: tenant };
}

export default function TempChangeClient() {
  const router = useRouter();

  const [pending, setPending] = useState<{ value: string; issuedAt: number } | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const expired = useMemo(() => {
    if (!pending) return true;
    return Date.now() - pending.issuedAt > 60_000;
  }, [pending]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPending(getPendingTemp());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const sessionUser = loadSessionUser();
    if (sessionUser?.id) {
      setUserId(sessionUser.id);
    }

    const existingTenant = getActiveTenantId();
    if (existingTenant) {
      setTenantId(existingTenant);
    }

    let cancelled = false;
    (async () => {
      try {
        const me = await fetchMe();
        if (cancelled) return;
        if (me.id) setUserId((prev) => prev ?? me.id);
        if (me.tenant_id) {
          setTenantId(me.tenant_id);
          setActiveTenantId(me.tenant_id);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error)?.message || "Failed to load account info");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    if (!expired) return;
    try {
      sessionStorage.removeItem("pending_temp_password");
    } catch {}
  }, [pending, expired]);

  const handleSubmit = async () => {
    if (!pending) {
      setError("No temporary password found. Contact your administrator.");
      return;
    }
    if (expired) {
      setError("Temporary password has expired. Contact your administrator.");
      return;
    }
    if (!tenantId) {
      setError("Missing tenant context. Try reloading the page.");
      return;
    }
    if (!userId) {
      setError("Missing user information. Try reloading the page.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await changeUserPassword(tenantId, userId, {
        current_password: pending.value,
        new_password: newPassword,
      });
      try {
        sessionStorage.removeItem("pending_temp_password");
      } catch {}
      setMessage("Password updated. Redirecting…");
      setTimeout(() => {
        router.replace("/dashboard");
      }, 1200);
    } catch (err) {
      setError((err as Error)?.message || "Failed to update password");
    } finally {
      setBusy(false);
    }
  };

  if (!pending) {
    return (
      <div className="mx-auto max-w-sm p-6">
        <h1 className="text-xl font-semibold mb-3">Temporary password expired</h1>
        <p className="text-sm text-muted-foreground">
          We couldn’t find an active temporary password. Please request a new one from your
          administrator.
        </p>
        <Button className="mt-4" onClick={() => router.replace("/login")}>Back to login</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Create a new password</h1>
        <p className="text-xs text-muted-foreground mt-1">
          Your temporary password is for one-time use. Set a new password to finish signing in.
        </p>
      </div>
      <div className="space-y-3">
        <div className="text-xs">
          <span className="font-medium">Temporary password:</span> {pending.value}
          {expired ? (
            <span className="text-red-600 ml-1">(expired)</span>
          ) : (
            <span className="text-blue-600 ml-1">(valid for a single use)</span>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">New password</label>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter a new password"
            minLength={8}
          />
        </div>
        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        {message ? <div className="text-sm text-green-600">{message}</div> : null}
        <Button
          onClick={handleSubmit}
          disabled={busy || expired || newPassword.length < 8}
          className="w-full"
        >
          {busy ? "Updating…" : "Update password"}
        </Button>
      </div>
    </div>
  );
}
