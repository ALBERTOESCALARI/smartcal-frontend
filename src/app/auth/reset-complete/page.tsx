"use client";

import { useRouter, useSearchParams } from "next/navigation";
import React, { useState } from "react";

export default function ResetCompleteClient() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border p-6 bg-white">
          <h1 className="text-xl font-semibold mb-2">Invalid link</h1>
          <p className="text-sm text-gray-600">
            This reset link is missing a token or has been malformed. Please
            request a new one.
          </p>
        </div>
      </div>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const base =
        process.env.NEXT_PUBLIC_API_BASE ||
        process.env.NEXT_PUBLIC_API_BASE_URL ||
        process.env.NEXT_PUBLIC_API_URL;

      if (!base) {
        throw new Error("API base URL is not configured.");
      }

      const res = await fetch(`${base}/auth/reset-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Reset failed.");
      }

      setOk(true);
      setTimeout(() => router.push("/login"), 1500);
    } catch (err: any) {
      setError(err.message || "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border p-6 bg-white">
        <h1 className="text-2xl font-semibold mb-2">Set your password</h1>
        <p className="text-sm text-gray-600 mb-6">
          Enter a new password for your account.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">New password</label>
            <input
              type="password"
              className="w-full rounded-lg border px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Confirm password</label>
            <input
              type="password"
              className="w-full rounded-lg border px-3 py-2"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {ok && <p className="text-sm text-green-600">Password updated! Redirecting…</p>}

          <button
            type="submit"
            className="w-full rounded-lg bg-black text-white py-2 font-medium disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? "Saving…" : "Save password"}
          </button>
        </form>

        <button
          className="mt-4 text-sm text-gray-600 underline"
          onClick={() => router.push("/login")}
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}