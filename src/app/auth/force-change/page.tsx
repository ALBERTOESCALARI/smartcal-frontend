"use client";
import { useRouter } from "next/navigation";
import * as React from "react";

export default function ForceChangePage() {
  const router = useRouter();
  const [me, setMe] = React.useState<{ id?: string; email?: string } | null>(null);
  const [current, setCurrent] = React.useState("");
  const [nextPwd, setNextPwd] = React.useState("");
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
        const url = base ? `${base}/auth/me` : "/auth/me";
        const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(url, { credentials: "include", headers });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const user = {
          id: data?.id ?? data?.user?.id,
          email: data?.email ?? data?.user?.email,
        };
        setMe(user);
        const mustChange = Boolean(data?.must_change_password ?? data?.user?.must_change_password);
        if (!mustChange) router.replace("/");
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!me?.id) return setMsg("Session not ready.");
    if (!current || !nextPwd) return setMsg("Enter both current and new password.");
    if (nextPwd.length < 8) return setMsg("New password must be at least 8 characters.");

    try {
      setBusy(true);
      setMsg(null);
      const tenantId = typeof window !== "undefined" ? localStorage.getItem("tenant_id") || "" : "";
      const base = (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
      const url = `${base || ""}/users/${encodeURIComponent(me.id)}/password?tenant_id=${encodeURIComponent(tenantId)}`;
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, {
        method: "PUT",
        credentials: "include",
        headers,
        body: JSON.stringify({ current_password: current, new_password: nextPwd }),
      });
      if (!res.ok) throw new Error((await res.text()) || `Failed (${res.status})`);
      setMsg("Password updated. Redirecting…");
      setTimeout(() => router.replace("/"), 800);
    } catch (err: any) {
      setMsg(err?.message || "Failed to update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold mb-2">Update Your Password</h1>
      <p className="text-sm text-slate-600 mb-6">You must change your password before using SmartCal.</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm mb-1">Current (temporary) password</label>
          <input className="w-full border rounded p-2" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm mb-1">New password</label>
          <input className="w-full border rounded p-2" type="password" value={nextPwd} onChange={(e) => setNextPwd(e.target.value)} required />
        </div>
        {msg ? <div className={`text-sm ${/fail|error/i.test(msg) ? "text-red-600" : "text-emerald-600"}`}>{msg}</div> : null}
        <button type="submit" className="rounded bg-black text-white px-4 py-2" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </main>
  );
}