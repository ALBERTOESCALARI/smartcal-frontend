// src/app/auth/reset-complete/Client.tsx
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Props = { token: string };

export default function ResetCompleteClient({ token }: Props) {
  const router = useRouter();
  const API_BASE = useMemo(
    () =>
      process.env.NEXT_PUBLIC_API_BASE ||
      process.env.NEXT_PUBLIC_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "",
    []
  );

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const disabled =
    busy || !token || password.length < 8 || password !== confirm || !API_BASE;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg(null);
    setOkMsg(null);

    if (!API_BASE) {
      setErrMsg("Missing NEXT_PUBLIC_API_BASE on the frontend.");
      return;
    }
    if (!token) {
      setErrMsg("This reset link is invalid or missing a token.");
      return;
    }
    if (password !== confirm) {
      setErrMsg("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setErrMsg("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      // Backend alias accepts { token, password } OR { token, new_password }
      const res = await fetch(`${API_BASE}/auth/reset-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (res.ok) {
        setOkMsg("Password updated. Redirecting to sign in…");
        setTimeout(() => router.push("/auth/login"), 1200);
      } else {
        let detail = "Reset failed. The link may be expired—request a new one.";
        try {
          const data = await res.json();
          if (typeof data?.detail === "string") detail = data.detail;
        } catch {}
        setErrMsg(detail);
      }
    } catch {
      setErrMsg("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold">Set your new password</h1>
        {!token && (
          <p className="mt-2 text-sm text-red-600">
            This link is invalid or missing a token. Please request a new reset.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">New password</label>
          <input
            type="password"
            className="w-full rounded-md border px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Minimum 8 characters.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Confirm password</label>
          <input
            type="password"
            className="w-full rounded-md border px-3 py-2"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        {okMsg && <p className="text-sm text-green-600">{okMsg}</p>}

        <button
          type="submit"
          className="w-full rounded-md bg-black text-white py-2 disabled:opacity-50"
          disabled={disabled}
        >
          {busy ? "Saving…" : "Save password"}
        </button>

        <button
          type="button"
          className="w-full rounded-md border py-2"
          onClick={() => router.push("/auth/login")}
        >
          Back to sign in
        </button>
      </form>

      {!API_BASE && (
        <p className="mt-4 text-xs text-orange-600">
          Tip: set <code>NEXT_PUBLIC_API_BASE</code> to your backend URL
          (e.g. <code>https://smartcal-backend-2cyq.onrender.com</code>).
        </p>
      )}
    </div>
  );
}