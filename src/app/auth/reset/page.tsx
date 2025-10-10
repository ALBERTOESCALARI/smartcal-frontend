"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/features/users/api";
import { useMemo, useState } from "react";

export default function ResetRequestPage() {
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmedEmployeeId = useMemo(() => employeeId.trim(), [employeeId]);
  const trimmedEmail = useMemo(() => email.trim(), [email]);

  const validEmail = useMemo(
    () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail),
    [trimmedEmail]
  );
  const canSend = !!trimmedEmployeeId && validEmail && !busy;

  async function onSend() {
    if (!canSend) return;
    setBusy(true);
    setMsg(null);
    try {
      await requestPasswordReset(trimmedEmployeeId, trimmedEmail);
      // Generic success to avoid account enumeration:
      setMsg("If that account exists, you’ll receive a reset link shortly.");
    } catch (err) {
      // Keep the same generic message even on error; log to console for you
      console.warn("reset request failed:", err);
      setMsg("If that account exists, you’ll receive a reset link shortly.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold">Forgot password</h1>
      <p className="text-sm text-muted-foreground mt-2">
        Enter your Employee ID and email to receive a reset link.
      </p>

      <div className="space-y-3 mt-4">
        <Input
          placeholder="Employee ID"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          autoComplete="off"
        />
        <Input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSend()}
          autoComplete="email"
        />
        <Button disabled={!canSend} onClick={onSend}>
          {busy ? "Sending…" : "Send reset link"}
        </Button>
        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
        {!validEmail && trimmedEmail.length > 0 && (
          <div className="text-xs text-red-600">Enter a valid email.</div>
        )}
      </div>
    </div>
  );
}