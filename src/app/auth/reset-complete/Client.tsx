"use client";

import { useRouter } from "next/navigation";
import React, { useState } from "react";

type Props = { token: string };

export default function ResetCompleteClient({ token }: Props) {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [show, setShow] = useState(false);

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

  // Inline validation states
  const pwdTooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;

  const isDisabled =
    submitting || password.length < 8 || password !== confirm;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className={`max-w-md w-full rounded-2xl border p-6 bg-white transition-colors ${
          ok ? "border-green-500" : "border-gray-200"
        }`}
      >
        <h1 className="text-2xl font-semibold mb-2">Set your password</h1>
        <p className="text-sm text-gray-600 mb-6">
          Enter a new password for your account.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* New password */}
          <div>
            <label className="block text-sm font-medium mb-1">New password</label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                className={`w-full rounded-lg border px-3 py-2 pr-16 ${
                  pwdTooShort ? "border-red-500" : "border-gray-300"
                }`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                aria-invalid={pwdTooShort ? "true" : "false"}
                aria-describedby="pwd-help"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-2 text-sm text-gray-600"
                onClick={() => setShow((s) => !s)}
              >
                {show ? "Hide" : "Show"}
              </button>
            </div>
            <p
              id="pwd-help"
              className={`mt-1 text-xs ${
                pwdTooShort ? "text-red-600" : "text-gray-500"
              }`}
            >
              Must be at least 8 characters.
            </p>
          </div>

          {/* Confirm password */}
          <div>
            <label className="block text-sm font-medium mb-1">Confirm password</label>
            <input
              type={show ? "text" : "password"}
              className={`w-full rounded-lg border px-3 py-2 ${
                mismatch ? "border-red-500" : "border-gray-300"
              }`}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              aria-invalid={mismatch ? "true" : "false"}
              aria-describedby="confirm-help"
            />
            <p
              id="confirm-help"
              className={`mt-1 text-xs ${
                mismatch ? "text-red-600" : "text-gray-500"
              }`}
            >
              Must match the password above.
            </p>
          </div>

          {/* Global error / success */}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {ok && (
            <p className="text-sm text-green-600" role="status" aria-live="polite">
              Password updated! Redirecting…
            </p>
          )}

          {/* Submit */}
          <button
            type="submit"
            className="w-full rounded-lg bg-black text-white py-2 font-medium disabled:opacity-60"
            disabled={isDisabled}
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