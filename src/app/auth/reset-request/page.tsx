"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/features/users/api";
import { useState } from "react";

export default function ResetRequestPage() {
  const [employeeId, setEmployeeId] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 className="text-xl font-semibold">Forgot password</h1>
      <div className="space-y-3 mt-4">
        <Input placeholder="Employee ID" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
        <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button
          disabled={!employeeId || !email || busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              await requestPasswordReset(employeeId.trim(), email.trim());
              setMsg("If that email exists, you’ll receive a reset link shortly.");
            } catch (error: unknown) {
              setMsg(getErrorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Sending…" : "Send reset link"}
        </Button>
        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      </div>
    </div>
  );
}
function getErrorMessage(err: unknown): string {
  if (!err) return "Failed to request reset";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "Failed to request reset";

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

  return "Failed to request reset";
}
