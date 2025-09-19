"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { login } from "@/lib/auth";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/dashboard");
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
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
        <div className="text-right mt-1">
          <Link
            href="/auth/reset-request"
            className="text-sm text-blue-600 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}