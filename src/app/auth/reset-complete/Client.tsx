// src/app/auth/reset-complete/Client.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completePasswordReset } from "@/features/users/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Unified error message extractor
function getErrMsg(err: unknown): string {
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
  }

  return "Request failed";
}

interface ResetCompleteClientProps {
  token: string;
}

export default function ResetCompleteClient({ token }: ResetCompleteClientProps) {
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
      setMsg(getErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 className="text-xl font-semibold">Set your password</h1>

      {!token && (
        <p className="mt-2 text-sm text-red-600">
          Missing or invalid token. Please request a new reset link.
        </p>
      )}

      <div className="space-y-3 mt-4">
        <Input
          type="password"
          placeholder="New password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && token && pw.length >= 8 && !busy) handleSave();
          }}
        />
        <div className="flex gap-2">
          <Button disabled={!token || pw.length < 8 || busy} onClick={handleSave}>
            {busy ? "Saving…" : "Save password"}
          </Button>
          <Link
            href="/login"
            className="inline-flex items-center rounded-md border px-3 py-2 text-sm hover:bg-accent"
          >
            Back to Login
          </Link>
        </div>
        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      </div>
    </div>
  );
}
