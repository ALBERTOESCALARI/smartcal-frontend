// src/app/users/page.tsx
"use client";

// ────────────────────────────────────────────────────────────────────────────────
// Imports
// ────────────────────────────────────────────────────────────────────────────────
import RequireAuth from "@/components/require-auth";
import {
  changeUserPassword,
  createUser,
  deleteUser,
  fetchUsers,
  inviteExistingUsers,
  inviteUser,
  unlockUser,
  updateUser,
  type CreateUserPayload,
  type Credential,
  type User,
} from "@/features/users/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

// Admin bulk import helper
async function postBulkUsers(tenantId: string, payload: any) {
  const base = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");
  if (!tenantId) throw new Error("Missing tenant id");
  const url = `${base}/users/bulk?tenant_id=${encodeURIComponent(tenantId)}`;
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data: any; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === "object" ? JSON.stringify(data) : String(data);
    throw new Error(`Bulk import failed (${res.status}): ${msg}`);
  }
  return data;
}

// ────────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────────
function BulkImportPanel({ tenantId, onDone }: { tenantId: string; onDone?: () => void }) {
  const [text, setText] = React.useState(`{\n  "users": [\n    { "email": "jane@example.com", "name": "Jane Doe", "employee_id": "E5001", "credentials": "EMT" },\n    { "email": "john@example.com", "name": "John Roe", "employee_id": "E5002", "role": "admin", "credentials": "Paramedic" }\n  ]\n}`);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  return (
    <div style={{ border: "1px solid #e5e7eb", padding: 12, borderRadius: 6, marginBottom: 16, background: "#f9fafb" }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Bulk import users (JSON)</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
      />
      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setMsg(null);
            try {
              setBusy(true);
              const payload = JSON.parse(text);
              const res = await postBulkUsers(tenantId, payload);
              setMsg(`Created: ${res.created}, Skipped: ${res.skipped}`);
              onDone?.();
            } catch (e: any) {
              setMsg(e?.message || "Bulk import failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Importing…" : "Import"}
        </button>
        {msg ? <div style={{ fontSize: 12 }}>{msg}</div> : null}
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
        Body must be an object with <code>users</code> array. Each row requires
        <code> email</code> and <code> employee_id</code>; optional <code>name</code>,
        <code> role</code> (defaults to <code>member</code>), and <code>credentials</code> (<code>EMT</code> or <code>Paramedic</code>).
      </div>
    </div>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();

  // Determine current user + role (to restrict page for members)
const [me, setMe] = React.useState<{
  name?: string;
  employee_id?: string;
  email?: string;
  role?: string;
} | null>(null);
const [loadingMe, setLoadingMe] = React.useState(true);
const [authRole, setAuthRole] = React.useState<string>("member");
const isAdmin = authRole === "admin";

React.useEffect(() => {
  let cancelled = false;
  async function loadMe() {
    try {
      const base = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
      const url = base ? `${base}/auth/me` : "/auth/me";
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url, { credentials: "include", headers });
      if (!res.ok) throw new Error("me failed");
      const data = await res.json();
      if (cancelled) return;
      const nextMe = {
        name: data?.name ?? data?.user?.name,
        employee_id: data?.employee_id ?? data?.user?.employee_id,
        email: data?.user?.email,
        role: data?.role ?? data?.user?.role,
      } as any;
      setMe(nextMe);
      setAuthRole(String(nextMe.role || "member").toLowerCase());
    } catch {
      // keep defaults
    } finally {
      if (!cancelled) setLoadingMe(false);
    }
  }
  loadMe();
  return () => {
  cancelled = true;
};
}, []);

  // ────────────────────────────────────────────────────────────────────────────
  // Local state
  // ────────────────────────────────────────────────────────────────────────────
  const [tenantId, setTenantId] = React.useState("");
  const [mounted, setMounted] = React.useState(false);

  // Add / Invite form state
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("member");
  const [employeeId, setEmployeeId] = React.useState("");

  // UI feedback
  const [showSuccess, setShowSuccess] = React.useState(false);
  const [generatedPw, setGeneratedPw] = React.useState<string | null>(null);
  const [copiedPw, setCopiedPw] = React.useState(false);
  const [inviteMsg, setInviteMsg] = React.useState<string | null>(null);
  const [showBulk, setShowBulk] = React.useState(false);
  // Invite existing users controls
  const [inviteAllBusy, setInviteAllBusy] = React.useState(false);
  const [inviteSelectedBusy, setInviteSelectedBusy] = React.useState(false);
  const [inviteExistingMsg, setInviteExistingMsg] = React.useState<string | null>(null);
  const [inviteEmails, setInviteEmails] = React.useState(""); // comma or newline separated
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Password change modal state
  const [pwOpen, setPwOpen] = React.useState(false);
  const [pwUser, setPwUser] = React.useState<User | null>(null);
  const [pwCurrent, setPwCurrent] = React.useState("");
  const [pwNew, setPwNew] = React.useState("");
  const [pwMsg, setPwMsg] = React.useState<string | null>(null);

  // Inline edit buffer for table rows
  const [edits, setEdits] = React.useState<
  Record<string, { email?: string; name?: string; role?: string; credentials?: Credential }>
>({});

  const [credentials, setCredentials] = React.useState<Credential>("EMT");

  

  // ────────────────────────────────────────────────────────────────────────────
  // Effects
  // ────────────────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    setMounted(true);
    try {
      const stored =
        typeof window !== "undefined" ? localStorage.getItem("tenant_id") : null;
      if (stored) setTenantId(stored);
    } catch {}
  }, []);

  React.useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────
  function saveTenantId(next: string) {
    if (typeof window !== "undefined") {
      localStorage.setItem("tenant_id", next);
    }
    setTenantId(next);
    queryClient.invalidateQueries({ queryKey: ["users", next] });
  }

  function setEdit(id: string, field: "credentials", value: Credential): void;
function setEdit(id: string, field: "email" | "name" | "role", value: string): void;
function setEdit(
  id: string,
  field: "email" | "name" | "role" | "credentials",
  value: string | Credential
) {
  setEdits((prev) => ({
    ...prev,
    [id]: { ...(prev[id] || {}), [field]: value } as {
      email?: string;
      name?: string;
      role?: string;
      credentials?: Credential;
    },
  }));
}

  function openPwModal(user: User) {
    setPwUser(user);
    setPwCurrent("");
    setPwNew("");
    setPwMsg(null);
    setPwOpen(true);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Data fetching
  // ────────────────────────────────────────────────────────────────────────────
  const { data: users, isLoading, isError, error } = useQuery({
    queryKey: ["users", tenantId],
    queryFn: () => fetchUsers(tenantId),
    enabled: !!tenantId,
  });

  // Employee dropdown filter
    // Employee dropdown filter + name search (must come after users is declared)
const [selectedUserId, setSelectedUserId] = React.useState<string>(""); // blank shows none by default
const [searchName, setSearchName] = React.useState<string>("");

const filteredUsers = React.useMemo(() => {
  const list = (users as User[] | undefined) ?? [];
  const norm = (s: string) => s.toLowerCase();

  // Base set based on dropdown
  let base: User[] = [];
  if (selectedUserId === "__ALL__") {
    base = list;
  } else if (selectedUserId) {
    base = list.filter((u) => u.id === selectedUserId);
  } else {
    // blank -> none by default unless searching
    base = [];
  }

  // Apply search by name (case-insensitive) if provided
  const q = searchName.trim();
  if (!q) {
    return base;
  }
  const qn = norm(q);

  // If blank or All, search across all; if specific user selected, still filter that base
  const haystack = selectedUserId === "" || selectedUserId === "__ALL__" ? list : base;
  return haystack.filter((u) => (u.name ? norm(u.name).includes(qn) : false));
}, [users, selectedUserId, searchName]);

  // ────────────────────────────────────────────────────────────────────────────
  // Mutations
  // ────────────────────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (payload: CreateUserPayload) => createUser(tenantId, payload),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["users", tenantId] });
      setEmail("");
      setName("");
      setRole("member");
      setEmployeeId("");
      setCredentials("EMT");
      setShowSuccess(true);
      setGeneratedPw(data?.temp_password ?? null);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        setShowSuccess(false);
        setGeneratedPw(null);
        createMut.reset();
      }, 4000);
    },
  });

  const updateMut = useMutation({
    // AFTER
    mutationFn: (args: {
  id: string;
  payload: { email?: string; name?: string; role?: string; credentials?: Credential };
}) => updateUser(tenantId, args.id, args.payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["users", tenantId] });
      const v: any = variables as any;
      if (v?.id) {
        setEdits((prev) => {
          const next = { ...prev } as any;
          delete next[v.id];
          return next;
        });
      }
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteUser(tenantId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users", tenantId] }),
  });

  const unlockMut = useMutation({
    mutationFn: (args: { id: string }) => unlockUser(tenantId, args.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", tenantId] });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status || err?.status;
      const msg =
        typeof detail === "string"
          ? detail
          : status
          ? `Failed to unlock (status ${status})`
          : err?.message || "Failed to unlock user";
      alert(msg);
    },
  });

  const createInvite = useMutation({
    mutationFn: (payload: {
      email: string;
      name?: string;
      role?: string;
      employee_id?: string;
      credentials: Credential;
    }) => inviteUser(tenantId, payload),
    onSuccess: () => {
      setInviteMsg("Invite sent (check email)");
      setTimeout(() => setInviteMsg(null), 2000);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail || (err as Error)?.message || "Failed to send invite";
      setInviteMsg(String(msg));
    },
  });

  const changePwMut = useMutation({
    mutationFn: (args: { id: string; current_password: string; new_password: string }) =>
      changeUserPassword(tenantId, args.id, {
        current_password: args.current_password,
        new_password: args.new_password,
      }),
    onSuccess: () => {
      setPwMsg("Password updated");
      setTimeout(() => {
        setPwMsg(null);
        setPwOpen(false);
        setPwUser(null);
        setPwCurrent("");
        setPwNew("");
      }, 1500);
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      const msg =
        typeof detail === "string"
          ? detail
          : status === 404
          ? "Password endpoint not found (restart backend?)"
          : status === 400
          ? "Current password is incorrect"
          : status === 422
          ? "Invalid request (check fields)"
          : status
          ? `Request failed (status ${status})`
          : "Failed to update password";
      setPwMsg(msg);
    },
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Handlers
  // ────────────────────────────────────────────────────────────────────────────
  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return alert("Set a tenant first");
    const em = email.trim();
    const emp = employeeId.trim();
    if (!em) return alert("Email is required");
    if (!emp) return alert("Employee ID is required");
    createMut.mutate({
      email: em,
      name: name.trim() || undefined,
      role,
      employee_id: emp,
      credentials,
    });
  }

  function handleSaveRow(user: User) {
  const patch = edits[user.id] || {};
  if (!patch.email && !patch.name && !patch.role && !patch.credentials) return; // nothing to save
  updateMut.mutate({ id: user.id, payload: patch });
}

  function handleDelete(id: string) {
    if (!confirm("Delete this user?")) return;
    deleteMut.mutate(id);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────────
  if (!mounted) {
  return <div />;
}

return (
  <RequireAuth>
    {!isAdmin ? (
      <div style={{ padding: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>Users</h1>
        <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 6, maxWidth: 520 }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            <strong>Name:</strong> {me?.name || "—"}
          </div>
          <div style={{ fontSize: 14, marginBottom: 6 }}>
            <strong>Employee ID:</strong> {me?.employee_id || "—"}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Contact your administrator for user management.
          </div>
        </div>
      </div>
    ) : (
      <div style={{ padding: 16 }}>

        {/* Tenant selector */}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 12,
            background: tenantId ? "#f8fafc" : "#fff7ed",
            padding: 8,
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            maxWidth: 520,
          }}
        >
          <label style={{ fontSize: 12 }}>Tenant ID</label>
          <input
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="Enter tenant_id"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => saveTenantId(tenantId)}
            style={{ background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "6px 12px", borderRadius: 6 }}
          >
            Save
          </button>
        </div>
        {!tenantId && (
          <div style={{ color: "#b45309", fontSize: 12, marginBottom: 12 }}>
            No tenant selected. Enter and save a tenant ID to load users.
          </div>
        )}

        {/* Add form */}
        <form
          onSubmit={handleCreate}
          style={{ display: "grid", gap: 8, maxWidth: 520, marginBottom: 20 }}
        >
          <div>
            <label style={{ display: "block", fontSize: 12 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12 }}>Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12 }}>Employee ID</label>
            <input
              type="text"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="e.g. E12345"
              required
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12 }}>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12 }}>Credentials</label>
            <select
              value={credentials}
              onChange={(e) => setCredentials(e.target.value as Credential)}
            >
              <option value="EMT">EMT</option>
              <option value="Paramedic">Paramedic</option>
            </select>
          </div>
          <div>
            <button
              type="submit"
              disabled={createMut.isPending || !tenantId || !employeeId}
              style={{ background: "#16a34a", color: "#fff", padding: "6px 12px", borderRadius: 6, border: "1px solid transparent", opacity: createMut.isPending ? 0.6 : 1 }}
            >
              {createMut.isPending ? "Adding…" : "Add User"}
            </button>
            {createMut.isError ? (
              <span style={{ color: "red", marginLeft: 8 }}>
                {(createMut.error as Error)?.message}
              </span>
            ) : null}
            {showSuccess ? (
              <span style={{ color: "green", marginLeft: 8 }}>Added.</span>
            ) : null}
            {generatedPw ? (
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>Temporary password:</div>
                  <button
                    type="button"
                    style={{ background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "4px 10px", borderRadius: 6 }}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(generatedPw);
                        setCopiedPw(true);
                        setTimeout(() => setCopiedPw(false), 1500);
                      } catch {}
                    }}
                  >
                    {copiedPw ? "Copied!" : "Copy"}
                  </button>
                </div>
                <code>{generatedPw}</code>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  Copy it now; it won't be shown again.
                </div>
              </div>
            ) : null}
          </div>
        </form>

        {/* Invite user (email link) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const em = email.trim();
            const emp = employeeId.trim();
            if (!tenantId) return alert("Set a tenant first");
            if (!em) return alert("Email is required");
            createInvite.mutate({
              email: em,
              name: name.trim() || undefined,
              role,
              employee_id: emp || undefined,
              credentials,
            });
          }}
          style={{ display: "grid", gap: 8, maxWidth: 520, marginBottom: 24 }}
        >
          <div style={{ fontWeight: 600 }}>Invite user (send email link)</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Sends a one-time link so the user can set their own password. No temp password needed.
          </div>
          <div>
            <button
              type="submit"
              disabled={!tenantId || createInvite.isPending}
              style={{ background: "#2563eb", color: "#fff", padding: "6px 12px", borderRadius: 6, border: "1px solid transparent", opacity: createInvite.isPending ? 0.6 : 1 }}
            >
              {createInvite.isPending ? "Sending…" : "Send Invite"}
            </button>
            {inviteMsg ? (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 12,
                  color: inviteMsg.includes("sent") ? "#16a34a" : "#b91c1c",
                }}
              >
                {inviteMsg}
              </span>
            ) : null}
          </div>
        </form>

        {/* Invite existing users */}
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            padding: 12,
            marginBottom: 24,
            maxWidth: 720,
            background: "#f9fafb",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Invite existing users</div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
            Send set‑password links to users that are already in this tenant.
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <button
              type="button"
              onClick={async () => {
                if (!tenantId) return alert("Set a tenant first");
                setInviteExistingMsg(null);
                setInviteAllBusy(true);
                try {
                  const res = await inviteExistingUsers(tenantId, { only_without_password: true });
                  setInviteExistingMsg(`Invited ${res.invited}/${res.total} (only users without password)`);
                } catch (e: any) {
                  setInviteExistingMsg(e?.message || "Failed to invite existing users");
                } finally {
                  setInviteAllBusy(false);
                }
              }}
              disabled={inviteAllBusy || !tenantId}
              style={{ background: "#2563eb", color: "#fff", padding: "6px 12px", borderRadius: 6, border: "1px solid transparent", opacity: inviteAllBusy ? 0.6 : 1 }}
            >
              {inviteAllBusy ? "Inviting…" : "Invite all without password"}
            </button>
          </div>

          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Invite selected emails</div>
            <textarea
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              placeholder="Paste emails (comma or newline separated)"
              rows={4}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
            />
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={async () => {
                  if (!tenantId) return alert("Set a tenant first");
                  const list = inviteEmails
                    .split(/[\n,]/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (list.length === 0) return alert("Add at least one email");
                  setInviteExistingMsg(null);
                  setInviteSelectedBusy(true);
                  try {
                    const res = await inviteExistingUsers(tenantId, { emails: list, only_without_password: false });
                    const ok = res.results.filter((r: any) => r.status === "invited").length;
                    const fail = res.results.filter((r: any) => r.status === "error").length;
                    setInviteExistingMsg(`Invited: ${ok} • Failed: ${fail}`);
                  } catch (e: any) {
                    setInviteExistingMsg(e?.message || "Failed to invite selected");
                  } finally {
                    setInviteSelectedBusy(false);
                  }
                }}
                disabled={inviteSelectedBusy || !tenantId}
                style={{ background: "#2563eb", color: "#fff", padding: "6px 12px", borderRadius: 6, border: "1px solid transparent", opacity: inviteSelectedBusy ? 0.6 : 1 }}
              >
                {inviteSelectedBusy ? "Inviting…" : "Invite selected"}
              </button>
            </div>
          </div>

          {inviteExistingMsg ? (
            <div style={{ fontSize: 12, marginTop: 8, color: inviteExistingMsg.includes("Invited") ? "#16a34a" : "#b91c1c" }}>
              {inviteExistingMsg}
            </div>
          ) : null}
        </div>

        {/* Bulk import (admin only, toggle visibility in-place) */}
{isAdmin && tenantId ? (
  <>
    <button
      type="button"
      onClick={() => setShowBulk((v) => !v)}
      style={{ background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "6px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}
      aria-expanded={showBulk}
      aria-controls="bulk-import-panel"
    >
      {showBulk ? "Hide bulk import" : "Show bulk import"}
    </button>

    {showBulk && (
      <div id="bulk-import-panel">
        <BulkImportPanel
          tenantId={tenantId}
          onDone={() =>
            queryClient.invalidateQueries({ queryKey: ["users", tenantId] })
          }
        />
      </div>
    )}
  </>
) : null}

        {/* Employee filter */}
{Array.isArray(users) && users.length > 0 ? (
  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
    <label style={{ fontSize: 12 }}>Show</label>
    <select
      value={selectedUserId}
      onChange={(e) => setSelectedUserId(e.target.value)}
      style={{ minWidth: 200 }}
    >
      {/* blank option shows none by default */}
      <option value=""> </option>
      <option value="__ALL__">All employees</option>
      {(users as User[]).map((u) => (
        <option key={u.id} value={u.id}>
          {(u.name && u.name.trim()) ? u.name : u.email}
          {u.employee_id ? ` · ${u.employee_id}` : ""}
          {(u as any).credentials ? ` · ${(u as any).credentials}` : ""}
        </option>
      ))}
    </select>
    <input
      type="text"
      value={searchName}
      onChange={(e) => setSearchName(e.target.value)}
      placeholder="Search by name"
      style={{ minWidth: 220 }}
    />
  </div>
) : null}

        {/* Users table */}
        {isLoading ? (
          <div>Loading users…</div>
        ) : isError ? (
          <div style={{ color: "red" }}>
            {(error as Error)?.message || "Failed to load users"}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
              <thead>
                <tr>
                <th style={th}>Email</th>
                <th style={th}>Employee ID</th>
                <th style={th}>Name</th>
                <th style={th}>Role</th>
                <th style={th}>Credentials</th>
                <th style={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(filteredUsers as User[] | undefined)?.map((u) => {
                  const pending =
                    updateMut.isPending && (updateMut.variables as any)?.id === u.id;
                  return (
                    <tr key={u.id}>
                      <td style={td}>
                        <input
                          type="email"
                          value={edits[u.id]?.email ?? u.email}
                          onChange={(e) => setEdit(u.id, "email", e.target.value)}
                          placeholder="user@example.com"
                          style={{ width: "100%" }}
                        />
                      </td>
                      <td style={td}>
                        <code>{(u as any).employee_id ?? "—"}</code>
                      </td>
                      <td style={td}>
                        <input
                          type="text"
                          value={
                            edits[u.id]?.name ?? (u.name || "")
                          }
                          onChange={(e) => setEdit(u.id, "name", e.target.value)}
                          placeholder="Full name"
                          style={{ width: "100%" }}
                        />
                      </td>
                      <td style={td}>
                        <select
                          value={edits[u.id]?.role ?? (u.role || "member")}
                          onChange={(e) => setEdit(u.id, "role", e.target.value)}
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td style={td}>
                        <select
                       value={edits[u.id]?.credentials ?? ((u as any).credentials || "")}
                       // AFTER
                        onChange={(e) => setEdit(u.id, "credentials", e.target.value as Credential)}
                        >
                         <option value="">(none)</option>
                         <option value="EMT">EMT</option>
                       <option value="Paramedic">Paramedic</option>
                           </select>
                            </td>
                      <td style={td}>
                        {(() => {
                          const patch: any = edits[u.id] || {};
                          const dirty =
                          patch.email !== undefined ||
                          patch.name !== undefined ||
                          patch.role !== undefined ||
                          patch.credentials !== undefined;
                          const disabled = pending || !tenantId || !dirty;
                          return (
                            <button onClick={() => handleSaveRow(u)} disabled={disabled} style={{ background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "4px 10px", borderRadius: 6 }}>
                              {pending ? "Saving…" : "Save"}
                            </button>
                          );
                        })()}
                        <button onClick={() => openPwModal(u)} style={{ marginLeft: 8, background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "4px 10px", borderRadius: 6 }} disabled={!tenantId}>
                          Change password
                        </button>
                        <button onClick={() => handleDelete(u.id)} style={{ marginLeft: 8, background: "#dc2626", color: "#fff", padding: "4px 10px", borderRadius: 6, border: "1px solid transparent", opacity: deleteMut.isPending ? 0.6 : 1 }} disabled={deleteMut.isPending || !tenantId}>
                          {deleteMut.isPending ? "Deleting…" : "Delete"}
                        </button>
                        {Boolean((u as any).is_locked) && (
                          <button
                            onClick={() => unlockMut.mutate({ id: u.id })}
                            style={{ marginLeft: 8, background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "4px 10px", borderRadius: 6 }}
                            disabled={
                              !tenantId ||
                              (unlockMut.isPending &&
                                (unlockMut.variables as any)?.id === u.id)
                            }
                          >
                            {unlockMut.isPending &&
                            (unlockMut.variables as any)?.id === u.id
                              ? "Unlocking…"
                              : "Unlock"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(!filteredUsers || (filteredUsers as User[]).length === 0) && (
              <tr>
    <td colSpan={6} style={{ padding: 12, fontStyle: "italic", color: "#64748b" }}>
      {selectedUserId === "" && !searchName.trim()
        ? "Select a user or search by name."
        : selectedUserId === "__ALL__" || searchName.trim()
        ? "No match."
        : "No users yet. Add one above."}
    </td>
  </tr>
)}
              </tbody>
            </table>
          </div>
        )}

        {/* Change password modal */}
        {pwOpen && pwUser ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 50,
            }}
          >
            <div
              style={{
                background: "white",
                padding: 20,
                width: 420,
                borderRadius: 8,
                boxShadow: "0 10px 20px rgba(0,0,0,0.2)",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 12 }}>
                Change password
              </div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
                {pwUser.email}
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ fontSize: 12 }}>
                  Current password
                  <input
                    type="password"
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    placeholder="Temporary or current password"
                    style={{ width: "100%" }}
                  />
                </label>
                <label style={{ fontSize: 12 }}>
                  New password
                  <input
                    type="password"
                    value={pwNew}
                    onChange={(e) => setPwNew(e.target.value)}
                    placeholder="New password"
                    style={{ width: "100%" }}
                  />
                </label>
                {pwMsg ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: String(pwMsg).includes("updated")
                        ? "#16a34a"
                        : "#b91c1c",
                    }}
                  >
                    {pwMsg}
                  </div>
                ) : null}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setPwOpen(false);
                      setPwUser(null);
                    }}
                    disabled={changePwMut.isPending}
                    style={{ background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "6px 12px", borderRadius: 6 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!tenantId) return alert("Set a tenant first");
                      if (!pwCurrent || !pwNew)
                        return alert("Enter both current and new password");
                      changePwMut.mutate({
                        id: pwUser.id,
                        current_password: pwCurrent,
                        new_password: pwNew,
                      });
                    }}
                    disabled={changePwMut.isPending}
                    style={{ background: "#2563eb", color: "#fff", padding: "6px 12px", borderRadius: 6, border: "1px solid transparent", opacity: changePwMut.isPending ? 0.6 : 1 }}
                  >
                    {changePwMut.isPending ? "Updating…" : "Update password"}
                  </button>
                </div>
              </div>
            </div>
          </div>
                ) : null}
      </div>
      )}
    </RequireAuth>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────────
const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 12,
  padding: "8px 6px",
};

const td: React.CSSProperties = {
  borderBottom: "1px solid #f1f5f9",
  padding: "8px 6px",
  verticalAlign: "middle",
};