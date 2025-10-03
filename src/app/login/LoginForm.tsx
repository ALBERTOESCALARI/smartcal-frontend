"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setActiveTenantId } from "@/lib/api"; // <-- ADD THIS
import { login } from "@/lib/auth";

interface LoginFormProps {
  reason?: string;
  initialTenantId?: string; // 👈 new, optional from URL
}

export default function LoginForm({ reason, initialTenantId }: LoginFormProps) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState(initialTenantId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // login expects (email, password)
      await login(email, password);

      // store tenant for the API layer / app shell
      setActiveTenantId(tenantId.trim());

      // redirect flow unchanged
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
        <div className="grid gap-1">
          <label className="text-sm">Tenant ID</label>
          <input
            type="text"
            className="border rounded-md px-3 py-2 text-sm font-mono"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="b046c6ad-527d-45ac-a291-ac485c913912"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </Card>
  );
}