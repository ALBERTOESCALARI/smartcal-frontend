
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completePasswordReset } from "@/features/users/api";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ResetCompletePage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const token = (Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token) || "";
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) setMsg("Missing token");
  }, [token]);

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 className="text-xl font-semibold">Set your password</h1>
      <div className="space-y-3 mt-4">
        <Input type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button
          disabled={!token || !pw || busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              await completePasswordReset(token, pw);
              setMsg("Password set! Redirecting to login…");
              setTimeout(() => router.push("/login"), 1200);
            } catch (e: any) {
              setMsg(e?.response?.data?.detail || e.message || "Failed to set password");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Save password"}
        </Button>
        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
      </div>
    </div>
  );
}