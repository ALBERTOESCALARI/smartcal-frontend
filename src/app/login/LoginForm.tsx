"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setActiveTenantId } from "@/lib/api";
import { login } from "@/lib/auth";

interface LoginFormProps {
  reason?: string;
  initialTenantId?: string;
}

export default function LoginForm({ reason, initialTenantId }: LoginFormProps) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState(initialTenantId ?? "");
  const [rememberTenant, setRememberTenant] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔹 Load remembered tenant if available
  useEffect(() => {
    const savedTenant = localStorage.getItem("remembered_tenant_id");
    if (savedTenant && !tenantId) {
      setTenantId(savedTenant);
      setRememberTenant(true);
    }
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      setActiveTenantId(tenantId.trim());

      // 🔹 Save or clear remembered tenant based on toggle
      if (rememberTenant) {
        localStorage.setItem("remembered_tenant_id", tenantId.trim());
      } else {
        localStorage.removeItem("remembered_tenant_id");
      }

      if (password.startsWith("TMP-")) {
        router.replace("/auth/temp-change");
      } else {
        router.replace("/dashboard");
      }
    } catch (err: unknown) {
      const maybeAxios = err as { response?: { data?: { detail?: string } } };
      setError(maybeAxios?.response?.data?.detail || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-sm p-6">
      <h1 className="text-xl font-semibold mb-4">Sign in to SmartCal</h1>
      {reason === "expired" && (
        <p className="mb-3 text-sm text-red-600">
          Your session has expired. Please sign in again.
        </p>
      )}
      <form onSubmit={onSubmit} className="grid gap-3">
        {/* Email */}
        <div className="grid gap-1">
          <label className="text-sm">Email</label>
          <input
            type="email"
            className="border rounded-md px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
          />
        </div>

        {/* Password */}
        <div className="grid gap-1">
          <label className="text-sm">Password</label>
          <input
            type="password"
            className="border rounded-md px-3 py-2 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>

        {/* Tenant ID */}
        <div className="grid gap-1">
          <label className="text-sm">Tenant ID</label>
          <input
            type="text"
            className="border rounded-md px-3 py-2 text-sm font-mono"
            value={rememberTenant ? "************" : tenantId}
            onChange={(e) => {
              if (!rememberTenant) setTenantId(e.target.value);
            }}
            placeholder="************"
            required
            readOnly={rememberTenant} // prevents edits while remembered
          />

          {/* Remember toggle */}
          <label className="flex items-center gap-2 mt-1 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={rememberTenant}
              onChange={(e) => {
                const checked = e.target.checked;
                setRememberTenant(checked);
                if (!checked) {
                  // user unchecked — allow editing again
                  localStorage.removeItem("remembered_tenant_id");
                }
              }}
            />
            Remember this Tenant ID
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}