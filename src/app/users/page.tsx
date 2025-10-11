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
  unlockUser,
  updateUser,
  type CreateUserPayload,
  type Credential,
  type User
} from "@/features/users/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

const PROTECTED_EMAIL = "albertoescalari2@yahoo.com";

function isProtectedEmail(email?: string | null) {
  return typeof email === "string" && email.toLowerCase() === PROTECTED_EMAIL;
}

// Unified error extractor (hoisted so it's available everywhere)
function getErrMsg(err: unknown): string {
  if (!err) return "Request failed";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "Request failed";

  if (typeof err === "object") {
    const maybe = err as {
      response?: { data?: { detail?: unknown } | string; status?: number };
      status?: number;
      message?: string;
    };
    const data = maybe.response?.data;
    if (typeof data === "string") return data;
    const detail =
      data && typeof data === "object" && "detail" in data
        ? (data as { detail?: unknown }).detail
        : undefined;
    if (typeof detail === "string") return detail;
    if (maybe.message) return maybe.message;
    if (data) {
      try {
        return JSON.stringify(data);
      } catch {
        return String(data);
      }
    }
  }

  return "Request failed";
}

// Admin bulk import helper
type BulkImportResult = {
  created?: number;
  skipped?: number;
  results?: Array<{ email?: string; status?: string; error?: string }>;
};

// Minimal shape returned by createUser endpoint
// (used only to read temp_password after creation)
export type CreateUserResponse = {
  id?: string;
  temp_password?: string | null;
};

async function postBulkUsers(tenantId: string, payload: unknown): Promise<BulkImportResult | string> {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");
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
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    const msg = typeof data === "string"
      ? data
      : (() => { try { return JSON.stringify(data); } catch { return String(data); } })();
    throw new Error(`Bulk import failed (${res.status}): ${msg}`);
  }
  return data as BulkImportResult | string;
}

function extractCredentialFromItem(item: unknown): string | undefined {
  if (typeof item === "string" && item.trim()) return item.trim();
  if (item && typeof item === "object") {
    const candidate = (item as {
      title?: string;
      name?: string;
      code?: string;
      abbreviation?: string;
      level?: string;
    });
    const value =
      candidate.title ||
      candidate.name ||
      candidate.code ||
      candidate.abbreviation ||
      candidate.level;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function getCredentialDisplay(user: User): string {
  const direct = user.credentials;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (Array.isArray(direct)) {
    const strings = direct
      .map((item) => extractCredentialFromItem(item))
      .filter((value): value is string => Boolean(value));
    if (strings.length > 0) return strings.join(", ");
  }
  if (typeof user.credential === "string" && user.credential.trim()) {
    return user.credential.trim();
  }
  return "";
}

function getCredentialValue(user: User): string {
  const direct = user.credentials;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (Array.isArray(direct)) {
    const first = direct.map((item) => extractCredentialFromItem(item)).find(Boolean);
    if (first) return first;
  }
  if (typeof user.credential === "string" && user.credential.trim()) {
    return user.credential.trim();
  }
  return "";
}


const TEMP_PASSWORD_PREFIX = "TMP-";

function makeTempPassword(): string {
  const length = 8;
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    window.crypto.getRandomValues(bytes);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@$#";
    return `${TEMP_PASSWORD_PREFIX}${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
  }
  return `${TEMP_PASSWORD_PREFIX}${Math.random().toString(36).slice(2, 2 + length).replace(/l|1|0|o/gi, "x")}`;
}

// ────────────────────────────────────────────────────────────────────────────────
type UserRow = User & { is_active?: boolean };

async function fetchUsersApi(tenantId: string, includeInactive: boolean): Promise<UserRow[]> {
  if (!tenantId) return [];
  const base =
    (process.env.NEXT_PUBLIC_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.NEXT_PUBLIC_API_BASE ||
      "").replace(/\/+$/, "");
  const url = `${base || ""}/users?tenant_id=${encodeURIComponent(
    tenantId
  )}&include_inactive=${includeInactive ? "true" : "false"}`;

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  headers["X-Tenant-ID"] = tenantId; // ✅ add header for consistency

  const res = await fetch(url, { credentials: "include", headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to fetch users (${res.status})`);
  }
  return res.json();
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
              if (typeof res === "string") {
                setMsg(res);
              } else {
                const created = res.created ?? 0;
                const skipped = res.skipped ?? 0;
                setMsg(`Created: ${created}, Skipped: ${skipped}`);
              }
              onDone?.();
            } catch (e: unknown) {
              setMsg(getErrMsg(e) || "Bulk import failed");
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
    Body must be an object with <code>users</code> array. Each row requires{" "}
    <code>email</code> and <code>employee_id</code>; optional <code>name</code>,{" "}
   <code>role</code> (defaults to <code>member</code>), and{" "}
    <code>credentials</code> (<code>EMT</code> or <code>Paramedic</code>).
    </div>
    </div>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();

  // Determine current user + role (to restrict page for members)
  type MeState = {
    id?: string;
    name?: string;
    employee_id?: string;
    email?: string;
    role?: string;
  };

  const [me, setMe] = React.useState<MeState | null>(null);
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
        const nextMe: MeState = {
          id: data?.id ?? data?.user?.id,
          name: data?.name ?? data?.user?.name,
          employee_id: data?.employee_id ?? data?.user?.employee_id,
          email: data?.user?.email,
          role: data?.role ?? data?.user?.role,
        };
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
  const [includeInactive, setIncludeInactive] = React.useState(false); // NEW

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
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [showBulk, setShowBulk] = React.useState(false);

  // Password change modal state
  const [pwOpen, setPwOpen] = React.useState(false);
  const [pwUser, setPwUser] = React.useState<User | null>(null);
  const [pwCurrent, setPwCurrent] = React.useState("");
  const [pwNew, setPwNew] = React.useState("");
  const [pwMsg, setPwMsg] = React.useState<string | null>(null);
  const [tempPw, setTempPw] = React.useState<string | null>(null);
  const [tempPwExpiresAt, setTempPwExpiresAt] = React.useState<number | null>(null);
  const [tempPwRemaining, setTempPwRemaining] = React.useState<number>(0);
  const tempPwTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Inline edit buffer for table rows
  const [edits, setEdits] = React.useState<
    Record<string, { email?: string; name?: string; role?: string; credentials?: Credential }>
  >({});

  const [credentials, setCredentials] = React.useState<Credential>("EMT");

  // Bulk reset state
  const [bulkTemp, setBulkTemp] = React.useState<string>("");
  const [bulkBusy, setBulkBusy] = React.useState<boolean>(false);
  const [bulkMsg, setBulkMsg] = React.useState<string | null>(null);
  // Timer for transient success messages
const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Selection state for per-user bulk actions
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

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
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      clearTempTimer();
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

  function clearTempTimer() {
    if (tempPwTimerRef.current !== null) {
      window.clearInterval(tempPwTimerRef.current);
      tempPwTimerRef.current = null;
    }
  }

  function isSelected(id: string) {
    return selectedIds.has(id);
  }

  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function selectAllVisible() {
    const ids = (filteredUsers || []).map(u => u.id);
    setSelectedIds(new Set(ids));
  }

  function startTempCountdown(expiresAt: number) {
    if (typeof window === "undefined") return;
    clearTempTimer();
    const update = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setTempPwRemaining(remaining);
      if (remaining <= 0) {
        clearTempTimer();
        setTempPw(null);
        setTempPwExpiresAt(null);
        setPwNew("");
        setPwMsg((prev) => prev ?? "Temporary password hidden. Generate a new one if needed.");
      }
    };
    update();
    tempPwTimerRef.current = window.setInterval(update, 1000);
  }

  function primeTempPassword(user: User) {
    const next = makeTempPassword();
    setTempPw(next);
    setPwNew(next);
    const expires = Date.now() + 60_000;
    setTempPwExpiresAt(expires);
    startTempCountdown(expires);
    setPwMsg("Temporary password generated. Share before it disappears.");
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
    clearTempTimer();
    setTempPw(null);
    setTempPwExpiresAt(null);
    const meEmail = (me?.email || "").toLowerCase();
    const isSelf = user.email?.toLowerCase() === meEmail;
    if (!isSelf) {
      primeTempPassword(user);
    }
    setPwOpen(true);
  }

  function closePwModal() {
    clearTempTimer();
    setPwOpen(false);
    setPwUser(null);
    setPwCurrent("");
    setPwNew("");
    setTempPw(null);
    setTempPwExpiresAt(null);
    setTempPwRemaining(0);
    setPwMsg(null);
    changePwMut.reset();
  }

  async function handleApplyTempPassword() {
    if (!pwUser || !tempPw) {
      setPwMsg("Generate a temporary password first.");
      return;
    }
    const requireAdminConfirm = (pwUser.role || "").toLowerCase() === "admin";
    if (requireAdminConfirm && !pwCurrent) {
      setPwMsg("Enter your admin password to confirm.");
      return;
    }
    try {
      setPwMsg(null);
      await changePwMut.mutateAsync({
        id: pwUser.id,
        current_password: requireAdminConfirm ? pwCurrent : TEMP_PASSWORD_PREFIX,
        new_password: tempPw,
      });
      setPwMsg("Temporary password set. Share it within the next minute.");
      setPwCurrent("");
    } catch (err) {
      setPwMsg(getErrMsg(err));
    }
  }

  async function handleUpdateOwnPassword() {
    if (!pwUser) return;
    if (!pwCurrent || !pwNew) {
      setPwMsg("Enter both current and new password.");
      return;
    }
    if (pwNew.length < 8) {
      setPwMsg("Password must be at least 8 characters long.");
      return;
    }
    try {
      setPwMsg(null);
      await changePwMut.mutateAsync({
        id: pwUser.id,
        current_password: pwCurrent,
        new_password: pwNew,
      });
      setPwMsg("Password updated. You can close this window.");
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        setPwMsg(null);
        closePwModal();
      }, 1500);
    } catch (err) {
      setPwMsg(getErrMsg(err));
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Data fetching
  // ────────────────────────────────────────────────────────────────────────────
  const { data: users, isLoading, isError, error } = useQuery<UserRow[], Error>({
    queryKey: ["users", tenantId, includeInactive],
    queryFn: () => fetchUsersApi(tenantId, includeInactive),
    enabled: !!tenantId,
  });

  // Default to showing all employees so the table and checkboxes are visible
  const [selectedUserId, setSelectedUserId] = React.useState<string>("__ALL__");
  const [searchName, setSearchName] = React.useState<string>("");

  const filteredUsers = React.useMemo<UserRow[]>(() => {
    const list = users ?? [];
    const norm = (s: string) => s.toLowerCase();

    // Base set based on dropdown
    let base: UserRow[] = [];
    if (!selectedUserId || selectedUserId === "__ALL__") {
      // blank or __ALL__ => show everything by default
      base = list;
    } else {
      base = list.filter((u) => u.id === selectedUserId);
    }

    // Apply search by name (case-insensitive) if provided
    const q = searchName.trim();
    if (!q) {
      return base;
    }
    const qn = norm(q);

    // If blank or All, search across all; if specific user selected, still filter that base
    const haystack = !selectedUserId || selectedUserId === "__ALL__" ? list : base;
    return haystack.filter((u) => (u.name ? u.name.toLowerCase().includes(qn) : false));
  }, [users, selectedUserId, searchName]);

  // ────────────────────────────────────────────────────────────────────────────
  // Mutations
  // ────────────────────────────────────────────────────────────────────────────
  const createMut = useMutation<CreateUserResponse, unknown, CreateUserPayload>({
    mutationFn: (payload) => createUser(tenantId, payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["users", tenantId] });
      setEmail("");
      setName("");
      setRole("member");
      setEmployeeId("");
      setCredentials("EMT");
      setShowSuccess(true);
      setGeneratedPw(data?.temp_password ?? null);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        setShowSuccess(false);
        setGeneratedPw(null);
        createMut.reset();
      }, 4000);
    },
  });

  const updateMut = useMutation<
    User,
    unknown,
    { id: string; payload: { email?: string; name?: string; role?: string; credentials?: Credential } }
  >({
    mutationFn: ({ id, payload }) => updateUser(tenantId, id, payload),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["users", tenantId] });
      if (variables.id) {
        setEdits((prev) => {
          const next = { ...prev };
          delete next[variables.id];
          return next;
        });
      }
    },
  });

  const deleteMut = useMutation<string, unknown, string>({
    mutationFn: (id) => deleteUser(tenantId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users", tenantId] }),
  });

  const unlockMut = useMutation<void, unknown, { id: string }>({
    mutationFn: ({ id }) => unlockUser(tenantId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", tenantId] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { detail?: string }; status?: number }; status?: number; message?: string };
      const detail = e?.response?.data?.detail;
      const status = e?.response?.status ?? e?.status;
      const msg =
        typeof detail === "string"
          ? detail
          : status
          ? `Failed to unlock (status ${status})`
          : e?.message || "Failed to unlock user";
      alert(msg);
    },
  });

  const changePwMut = useMutation({
    mutationFn: (args: { id: string; current_password: string; new_password: string }) => {
      if (!args.new_password || args.new_password.length < 8) {
        throw new Error("Password must be at least 8 characters long.");
      }
      return changeUserPassword(tenantId, args.id, {
        current_password: args.current_password,
        new_password: args.new_password,
      });
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
    const patch = edits[user.id];
    if (!patch) return;
    const hasChanges =
      patch.email !== undefined ||
      patch.name !== undefined ||
      patch.role !== undefined ||
      patch.credentials !== undefined;
    if (!hasChanges) return;
    updateMut.mutate({ id: user.id, payload: patch });
  }

  function handleDelete(id: string) {
    const target = users?.find((u) => u.id === id);
    if (target && isProtectedEmail(target.email)) {
      alert("This account cannot be deleted.");
      return;
    }
    if (!confirm("Deactivate this user?")) return;
    deleteMut.mutate(id);
  }

  async function handleReactivate(id: string) {
    if (!tenantId) return alert("Set a tenant first");
    const base =
      (process.env.NEXT_PUBLIC_API_BASE_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.NEXT_PUBLIC_API_BASE ||
        "").replace(/\/+$/, "");
    const url = `${base || ""}/users/${encodeURIComponent(id)}/reactivate?tenant_id=${encodeURIComponent(tenantId)}`;
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    headers["X-Tenant-ID"] = tenantId;

    const res = await fetch(url, { credentials: "include", headers });
    if (!res.ok) {
      const text = await res.text();
      alert(text || `Failed to reactivate (${res.status})`);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["users", tenantId] });
  }

  async function handleBulkResetMembers(ids?: string[]) {
    if (!tenantId) {
      alert("Set a tenant first");
      return;
    }
    if (!Array.isArray(users) || users.length === 0) {
      alert("No users loaded");
      return;
    }
    const pwd = bulkTemp.trim();
    if (!pwd) {
      alert("Enter a temporary password to apply");
      return;
    }
    const scopeLabel = ids && ids.length > 0 ? `the ${ids.length} selected user(s)` : "ALL active members";
    if (!confirm(`Apply this temporary password to ${scopeLabel}? This will overwrite their current passwords.`)) {
      return;
    }

    setBulkBusy(true);
    setBulkMsg(null);

    let ok = 0;
    let fail = 0;

    const targetList = (ids && ids.length > 0)
      ? (users || []).filter(u => ids.includes(u.id))
      : (users || []);

    // Process sequentially to avoid hammering the API
    for (const u of targetList) {
      const role = String(u.role || "member").toLowerCase();
      const isActive = u.is_active !== false;
      if (role !== "member" || !isActive) continue;

      try {
        await changeUserPassword(tenantId, u.id, {
          current_password: "TMP-ADMIN-BULK",
          new_password: pwd,
        });
        ok += 1;
      } catch (e) {
        fail += 1;
        // eslint-disable-next-line no-console
        console.warn("Bulk reset failed for", u.email || u.id, e);
      }
    }

    setBulkBusy(false);
    setBulkMsg(`Done. Updated ${ok} member${ok === 1 ? "" : "s"}${fail ? ` • Failed: ${fail}` : ""}`);
    queryClient.invalidateQueries({ queryKey: ["users", tenantId, includeInactive] });
    clearSelection();
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
        <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-6">
          {/* Tenant selector */}
          <div className={`rounded-lg border p-3 md:p-4 max-w-xl shadow-sm ${tenantId ? 'bg-slate-50' : 'bg-amber-50'}`}>
            <div className="text-sm font-medium mb-2">Tenant ID</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="Enter tenant_id"
                className="w-full rounded-md border px-3 py-2"
              />
              <button
                type="button"
                onClick={() => saveTenantId(tenantId)}
                className="rounded-md px-3 py-2 text-sm font-medium bg-white border hover:bg-neutral-50"
              >
                Save
              </button>
            </div>
          </div>
          {!tenantId && (
            <div className="text-amber-700 text-xs">
              No tenant selected. Enter and save a tenant ID to load users.
            </div>
          )}

          {/* Show deactivated toggle (admin) */}
          {tenantId ? (
            <div className="text-sm flex items-center gap-2">
              <label>
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(e) => setIncludeInactive(e.target.checked)}
                />{" "}
                Show deactivated users
              </label>
            </div>
          ) : null}

          {/* Add form (inputs only; remove Add User button) */}
          <div className="max-w-xl space-y-4">
            <div className="space-y-1">
              <label htmlFor="user-email" className="text-sm font-medium">Email</label>
              <input
                id="user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="user-name" className="text-sm font-medium">Name (optional)</label>
              <input
                id="user-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="user-empid" className="text-sm font-medium">Employee ID</label>
              <input
                id="user-empid"
                type="text"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                placeholder="e.g. E12345"
                required
                className="w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="user-role" className="text-sm font-medium">Role</label>
                <select
                  id="user-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="user-creds" className="text-sm font-medium">Credentials</label>
                <select
                  id="user-creds"
                  value={credentials}
                  onChange={(e) => setCredentials(e.target.value as Credential)}
                  className="w-full rounded-md border px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="EMT">EMT</option>
                  <option value="Paramedic">Paramedic</option>
                </select>
              </div>
            </div>
          </div>

          {/* Add user submit (admin only) */}
          <form
            onSubmit={handleCreate}
            className="rounded-lg border bg-white p-4 shadow-sm max-w-xl space-y-2"
          >
            <div style={{ fontWeight: 600 }}>Add user to tenant</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Creates the user in the database for this tenant. <strong>Email</strong> and <strong>Employee ID</strong> are required.
            </div>
            <div>
              <button
                type="submit"
                disabled={!tenantId || createMut.isPending || !email.trim() || !employeeId.trim()}
                className={`rounded-md px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 ${createMut.isPending ? 'opacity-60' : ''}`}
                aria-disabled={!tenantId || createMut.isPending || !email.trim() || !employeeId.trim()}
              >
                {createMut.isPending ? "Adding…" : "Add User"}
              </button>
            </div>
            {showSuccess ? (
              <div style={{ fontSize: 12, color: "#16a34a" }}>
                User created successfully
                {generatedPw ? (
                  <span className="ml-2">
                    · Temp password: <code>{generatedPw}</code>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== "undefined" && navigator.clipboard) {
                          navigator.clipboard
                            .writeText(generatedPw)
                            .then(() => setCopiedPw(true))
                            .catch(() => {});
                          setTimeout(() => setCopiedPw(false), 1500);
                        }
                      }}
                      className="ml-2 rounded-md px-2 py-1 text-xs font-medium bg-white border hover:bg-neutral-50"
                    >
                      {copiedPw ? "Copied!" : "Copy"}
                    </button>
                  </span>
                ) : null}
              </div>
            ) : null}
          </form>


          {/* BULK RESET PASSWORDS FOR MEMBERS */}
          <div className="rounded-lg border bg-white p-4 shadow-sm max-w-3xl">
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Bulk reset passwords (members)</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
              Set the <strong>same temporary password</strong> for every active member in this tenant. They should change it on first login.
            </div>

            <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
              <label style={{ fontSize: 12 }}>
                Temporary password to apply
                <input
                  type="text"
                  value={bulkTemp}
                  onChange={(e) => setBulkTemp(e.target.value)}
                  placeholder="e.g. HC-Temp-2025!"
                  className="w-full rounded-md border px-3 py-2"
                />
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => handleBulkResetMembers()}
                  disabled={!tenantId || bulkBusy || !bulkTemp.trim() || !Array.isArray(users) || users.length === 0}
                  className={`rounded-md px-3 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 ${bulkBusy ? 'opacity-60' : ''}`}
                >
                  {bulkBusy ? "Resetting…" : "Apply to all members"}
                </button>
                {bulkMsg ? (
                  <span
                    style={{
                      fontSize: 12,
                      color: String(bulkMsg).toLowerCase().includes("fail") ? "#b91c1c" : "#16a34a",
                    }}
                  >
                    {bulkMsg}
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
              Applies to the <strong>selected users</strong> only (role <code>member</code>, active). Admins are skipped.
              </div>
            </div>
          </div>

          {/* Bulk import (admin only, toggle visibility in-place) */}
          {isAdmin && tenantId ? (
            <>
              <button
                type="button"
                onClick={() => setShowBulk((v) => !v)}
                className="rounded-md px-3 py-2 text-sm font-medium bg-white border hover:bg-neutral-50"
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
                {/* blank option shows all */}
                <option value=""> </option>
                <option value="__ALL__">All employees</option>
                {(users ?? []).map((u) => {
                  const credential = getCredentialDisplay(u);
                  return (
                    <option key={u.id} value={u.id}>
                      {(u.name && u.name.trim()) ? u.name : u.email}
                      {u.employee_id ? ` · ${u.employee_id}` : ""}
                      {credential ? ` · ${credential}` : ""}
                    </option>
                  );
                })}
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
            <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={th}>
                      <input
                        type="checkbox"
                        onChange={(e) => {
                          if (e.target.checked) selectAllVisible();
                          else clearSelection();
                        }}
                        checked={filteredUsers.length > 0 && filteredUsers.every(u => isSelected(u.id))}
                        aria-label="Select all visible"
                      />
                    </th>
                    <th style={th}>Email</th>
                    <th style={th}>Employee ID</th>
                    <th style={th}>Name</th>
                    <th style={th}>Role</th>
                    <th style={th}>Credentials</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const pending = updateMut.isPending && updateMut.variables?.id === u.id;
                    const protectedUser = isProtectedEmail(u.email);
                    return (
                      <tr key={u.id}>
                        <td style={td}>
                          <input
                            type="checkbox"
                            checked={isSelected(u.id)}
                            onChange={() => toggleSelected(u.id)}
                            aria-label={`Select ${u.email || u.name || u.employee_id || u.id}`}
                          />
                        </td>
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
                          <code>{u.employee_id ?? "—"}</code>
                        </td>
                        <td style={td}>
                          <input
                            type="text"
                            value={edits[u.id]?.name ?? (u.name || "")}
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
                            value={edits[u.id]?.credentials ?? getCredentialValue(u)}
                            onChange={(e) => setEdit(u.id, "credentials", e.target.value as Credential)}
                          >
                            <option value="">(none)</option>
                            <option value="EMT">EMT</option>
                            <option value="Paramedic">Paramedic</option>
                          </select>
                        </td>
                        <td style={td}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            {(() => {
                              const patch = edits[u.id];
                              const dirty = Boolean(
                                patch &&
                                (patch.email !== undefined ||
                                  patch.name !== undefined ||
                                  patch.role !== undefined ||
                                  patch.credentials !== undefined)
                              );
                              const disabled = pending || !tenantId || !dirty;
                              return (
                                <button onClick={() => handleSaveRow(u)} disabled={disabled} style={{ background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "4px 10px", borderRadius: 6 }}>
                                  {pending ? "Saving…" : "Save"}
                                </button>
                              );
                            })()}

                            <button
                              onClick={() => openPwModal(u)}
                              style={{ background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "4px 10px", borderRadius: 6 }}
                              disabled={!tenantId}
                            >
                              Change password
                            </button>

                            {!protectedUser ? (
                              u.is_active !== false ? (
                                <button
                                  onClick={() => handleDelete(u.id)}
                                  style={{ background: "#dc2626", color: "#fff", padding: "4px 10px", borderRadius: 6, border: "1px solid transparent", opacity: deleteMut.isPending ? 0.6 : 1 }}
                                  disabled={deleteMut.isPending || !tenantId}
                                >
                                  {deleteMut.isPending ? "Deactivating…" : "Deactivate"}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleReactivate(u.id)}
                                  style={{ background: "#16a34a", color: "#fff", padding: "4px 10px", borderRadius: 6, border: "1px solid transparent" }}
                                  disabled={!tenantId}
                                >
                                  Reactivate
                                </button>
                              )
                            ) : (
                              <span style={{ fontSize: 12, color: "#64748b" }}>Deletion locked</span>
                            )}

                            {Boolean(u.is_locked) && (
                              <button
                                onClick={() => unlockMut.mutate({ id: u.id })}
                                style={{ background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "4px 10px", borderRadius: 6 }}
                                disabled={
                                  !tenantId ||
                                  (unlockMut.isPending &&
                                    unlockMut.variables?.id === u.id)
                                }
                              >
                                {unlockMut.isPending &&
                                unlockMut.variables?.id === u.id
                                  ? "Unlocking…"
                                  : "Unlock"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: 12, fontStyle: "italic", color: "#64748b" }}>
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
                {(() => {
                  const meEmail = (me?.email || "").toLowerCase();
                  const isSelf = pwUser.email?.toLowerCase() === meEmail;
                  const needsAdminConfirm = !isSelf && (pwUser.role || "").toLowerCase() === "admin";
                  const showCurrentField = isSelf || needsAdminConfirm;

                  return (
                    <div style={{ display: "grid", gap: 10 }}>
                      {showCurrentField ? (
                        <label style={{ fontSize: 12 }}>
                          {isSelf
                            ? "Your current password"
                            : "Your admin password (for confirmation)"}
                          <input
                            type="password"
                            value={pwCurrent}
                            onChange={(e) => setPwCurrent(e.target.value)}
                            placeholder={isSelf ? "Current password" : "Enter your password"}
                            style={{ width: "100%" }}
                          />
                        </label>
                      ) : null}

                      {isSelf ? (
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
                      ) : (
                        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 10, background: "#f9fafb", display: "grid", gap: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            Temporary password
                            {tempPw && tempPwRemaining > 0 ? (
                              <span style={{ marginLeft: 6, fontWeight: 400, color: "#2563eb" }}>
                                (expires in {tempPwRemaining}s)
                              </span>
                            ) : null}
                          </div>
                          {tempPw ? (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <input
                                type="text"
                                readOnly
                                value={tempPw}
                                style={{ flex: 1, minWidth: 220, fontSize: 12, padding: 6, border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff" }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                                    navigator.clipboard.writeText(tempPw).catch(() => {});
                                  }
                                }}
                                className="rounded-md px-3 py-2 text-sm font-medium bg-white border hover:bg-neutral-50"
                              >
                                Copy
                              </button>
                              <button
                                type="button"
                                onClick={() => primeTempPassword(pwUser)}
                                className="rounded-md px-3 py-2 text-sm font-medium bg-white border hover:bg-neutral-50"
                              >
                                Regenerate
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => primeTempPassword(pwUser)}
                              className="rounded-md px-3 py-2 text-sm font-medium bg-white border hover:bg-neutral-50"
                            >
                              Generate temporary password
                            </button>
                          )}
                          <p style={{ fontSize: 12, color: "#64748b" }}>
                            Share this password securely. After login the user should change it immediately.
                          </p>
                        </div>
                      )}

                      {pwMsg ? (
                        <div
                          style={{
                            fontSize: 12,
                            color: String(pwMsg).toLowerCase().includes("fail") || String(pwMsg).toLowerCase().includes("error")
                              ? "#b91c1c"
                              : "#16a34a",
                          }}
                        >
                          {pwMsg}
                        </div>
                      ) : null}

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={closePwModal}
                          disabled={changePwMut.isPending}
                          style={{ background: "#ffffff", color: "#111827", border: "1px solid #e5e7eb", padding: "6px 12px", borderRadius: 6 }}
                        >
                          Close
                        </button>
                        {isSelf ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!tenantId) {
                                alert("Set a tenant first");
                                return;
                              }
                              handleUpdateOwnPassword();
                            }}
                            disabled={changePwMut.isPending}
                            style={{ background: "#2563eb", color: "#fff", padding: "6px 12px", borderRadius: 6, border: "1px solid transparent", opacity: changePwMut.isPending ? 0.6 : 1 }}
                          >
                            {changePwMut.isPending ? "Updating…" : "Update password"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (!tenantId) {
                                alert("Set a tenant first");
                                return;
                              }
                              handleApplyTempPassword();
                            }}
                            disabled={changePwMut.isPending || !tempPw}
                            style={{ background: "#2563eb", color: "#fff", padding: "6px 12px", borderRadius: 6, border: "1px solid transparent", opacity: changePwMut.isPending ? 0.6 : 1 }}
                          >
                            {changePwMut.isPending ? "Applying…" : "Apply temporary password"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
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