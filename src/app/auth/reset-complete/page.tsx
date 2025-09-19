"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completePasswordReset } from "@/features/users/api";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function ResetCompleteInner() {
  const sp = useSearchParams();
  const token = sp.get("token") || "";
  const router = useRouter();

  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!token) throw new Error("Missing token");
      await completePasswordReset(token, pw);
      setMsg("Password set! Redirecting to login…");
      setTimeout(() => router.push("/login"), 1200);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      const detail = err?.response?.data?.detail;
      setMsg(detail || err?.message || "Failed to set password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 className="text-xl font-semibold">Set your password</h1>

      {!token && (
        <p className="mt-2 text-sm text-red-600">Missing or invalid token. Please request a new reset link.</p>
      )}

      <div className="space-y-3 mt-4">
        <Input
          type="password"
          placeholder="New password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <div className="flex gap-2">
          <Button disabled={!token || !pw || busy} onClick={handleSave}>
            {busy ? "Saving…" : "Save password"}
          </Button>
          <Link href="/login" className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-accent">
            Back to Login
          </Link>
        </div>
        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      </div>
    </div>
  );
}

export default function ResetCompletePage() {
  return (
    <div className="min-h-screen grid place-items-center p-6">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ResetCompleteInner />
      </Suspense>
    </div>
  );
}