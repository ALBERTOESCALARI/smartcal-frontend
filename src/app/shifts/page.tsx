// src/app/shifts/page.tsx
"use client";
import RequireAuth from "@/components/require-auth";
import ClockControls from "@/components/time/clock-controls";
import { Button } from "@/components/ui/button";
import { Calendar, type DayShift } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import {
  canDeleteShift,
  createShift,
  deleteShift,
  fetchShifts,
  getShift,
  updateShift,
  type DeleteBlockers,
  type Shift,
} from "@/features/shifts/api";
import { fetchUnits, type Unit } from "@/features/units/api";
import { api } from "@/lib/api";
import { loadSessionUser, type SessionUser } from "@/lib/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

// ----- Types & helpers -----
type User = {
  id: string;
  email: string;
  name?: string;
  employee_id?: string;
  credential?: string;
  primary_credential?: string;
  certification?: string;
  certifications?: string[];
  ems_level?: string;
  roles?: string[];
  role?: string;
  credentials?:
    | string
    | Array<
        | string
        | {
            title?: string;
            name?: string;
            code?: string;
            abbreviation?: string;
            level?: string;
            type?: string;
          }
      >;
};

async function fetchUsers(tenantId: string) {
  const { data } = await api.get<User[]>("/users", { params: { tenant_id: tenantId } });
  return data;
}

type AuthMeResponse = {
  id?: string;
  user_id?: string;
  email?: string;
  role?: string;
  name?: string;
  employee_id?: string;
  user?:
    | {
        id?: string;
        user_id?: string;
        email?: string;
        role?: string;
        name?: string;
        employee_id?: string;
      }
    | null;
};

type AuthSnapshot = {
  id?: string;
  email?: string;
  role?: string;
  name?: string;
  employee_id?: string;
};

function extractAuthSnapshot(value: unknown): AuthSnapshot {
  if (!value || typeof value !== "object") return {};
  const source = value as {
    id?: unknown;
    user_id?: unknown;
    email?: unknown;
    role?: unknown;
    name?: unknown;
    employee_id?: unknown;
    user?: unknown;
  };

  const snapshot: AuthSnapshot = {};
  if (typeof source.id === "string" && source.id) snapshot.id = source.id;
  if (!snapshot.id && typeof source.user_id === "string" && source.user_id) snapshot.id = source.user_id;
  if (typeof source.email === "string" && source.email) snapshot.email = source.email;
  if (typeof source.role === "string" && source.role) snapshot.role = source.role;
  if (typeof source.name === "string" && source.name) snapshot.name = source.name;
  if (typeof source.employee_id === "string" && source.employee_id) snapshot.employee_id = source.employee_id;

  if (source.user && typeof source.user === "object") {
    const nested = extractAuthSnapshot(source.user);
    snapshot.id = snapshot.id ?? nested.id;
    snapshot.email = snapshot.email ?? nested.email;
    snapshot.role = snapshot.role ?? nested.role;
    snapshot.name = snapshot.name ?? nested.name;
    snapshot.employee_id = snapshot.employee_id ?? nested.employee_id;
  }
  return snapshot;
}

async function fetchMe(): Promise<AuthMeResponse> {
  const { data } = await api.get<AuthMeResponse>("/auth/me");
  return data;
}

function toDatetimeLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function roundToNextQuarter(d = new Date()) {
  const t = new Date(d);
  t.setSeconds(0, 0);
  const m = t.getMinutes();
  const next = Math.ceil(m / 15) * 15;
  t.setMinutes(next === 60 ? 0 : next);
  if (next === 60) t.setHours(t.getHours() + 1);
  return t;
}
function startOfDay(d: Date) {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function overlaps(aStartISO: string, aEndISO: string, bStartISO: string, bEndISO: string) {
  const aStart = new Date(aStartISO).getTime();
  const aEnd = new Date(aEndISO).getTime();
  const bStart = new Date(bStartISO).getTime();
  const bEnd = new Date(bEndISO).getTime();
  if ([aStart, aEnd, bStart, bEnd].some(Number.isNaN)) return false;
  return aStart < bEnd && bStart < aEnd;
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function hasDate(arr: Date[], d: Date) {
  const key = ymd(d);
  return arr.some((x) => ymd(x) === key);
}
function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number) {
  const t = new Date(d);
  t.setMonth(t.getMonth() + n);
  return t;
}
function formatMonthYear(d: Date) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}
function loadUserFromToken(): { id?: string; email?: string } | null {
  try {
    if (typeof window === "undefined") return null;
    const token = localStorage.getItem("token");
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = atob(base64);
    const json = JSON.parse(payload);
    return { id: json.sub || json.user_id || json.id, email: json.email };
  } catch {
    return null;
  }
}
function getDisplayName(u: User): string {
  const n = (u.name || "").trim();
  if (n) return n;
  const e = (u.email || "").trim();
  const pre = e.includes("@") ? e.split("@")[0] : e;
  return pre || "User";
}
const getErrMsg = (err: unknown): string => {
  if (!err) return "Unexpected error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "Unexpected error";
  if (typeof err === "object") {
    const maybe = err as { response?: { data?: { detail?: unknown } | string }; message?: string };
    const data = maybe.response?.data;
    if (typeof data === "string") return data;
    const detail = data && typeof data === "object" && "detail" in data ? (data as { detail?: unknown }).detail : undefined;
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
  return "Unexpected error";
};
function getEmployeeId(u: User): string {
  return (u as { employee_id?: string })?.employee_id ?? "";
}
function getPrimaryCredential(u: User): string {
  const direct = (
    (typeof u.credentials === "string" ? u.credentials : "") ||
    u.credential ||
    u.primary_credential ||
    u.certification ||
    u.ems_level ||
    (Array.isArray(u.certifications) && u.certifications[0]) ||
    ""
  )
    ?.toString()
    .trim();

  let fromArray = "";
  if (!direct && Array.isArray(u.credentials) && u.credentials.length) {
    for (const c of u.credentials) {
      if (typeof c === "string" && c.trim()) {
        fromArray = c.trim();
        break;
      }
      if (typeof c === "object" && c) {
        const cand = (c.title || c.name || c.code || c.abbreviation || c.level || c.type || "").toString().trim();
        if (cand) {
          fromArray = cand;
          break;
        }
      }
    }
  }

  const raw = (direct || fromArray || "").toUpperCase();
  const norm = raw
    .replace(/^EMT[-_ ]?B(ASIC)?$/, "EMT")
    .replace(/^EMT$/, "EMT")
    .replace(/^(EMT[-_ ]?P|PARAMEDIC)$/, "PARAMEDIC")
    .replace(/^AEMT$/, "AEMT")
    .replace(/^EMR$/, "EMR");

  switch (norm) {
    case "PARAMEDIC":
      return "Paramedic";
    case "EMT":
      return "EMT";
    case "AEMT":
      return "AEMT";
    case "EMR":
      return "EMR";
    default:
      const base = direct || fromArray || "";
      return base ? base.replace(/\b\w+/g, (w) => w[0]?.toUpperCase() + w.slice(1).toLowerCase()) : "";
  }
}

export default function ShiftsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [tenantId, setTenantId] = useState("");
  useEffect(() => {
    const t = typeof window !== "undefined" ? localStorage.getItem("tenant_id") : null;
    if (t) setTenantId(t);
  }, []);

  // Preload pickers
  const unitsQ = useQuery<Unit[]>({
    queryKey: ["units-picker", tenantId],
    queryFn: () => fetchUnits(tenantId),
    enabled: Boolean(tenantId),
    retry: false,
  });

  const usersQ = useQuery<User[]>({
    queryKey: ["users-picker", tenantId],
    queryFn: () => fetchUsers(tenantId),
    enabled: Boolean(tenantId),
    retry: false,
  });

  const usersSorted = useMemo(() => {
    const arr = Array.isArray(usersQ.data) ? [...usersQ.data] : [];
    arr.sort((a, b) => {
      const an = getDisplayName(a).toLowerCase();
      const bn = getDisplayName(b).toLowerCase();
      if (an !== bn) return an.localeCompare(bn);
      const ac = getPrimaryCredential(a).toLowerCase();
      const bc = getPrimaryCredential(b).toLowerCase();
      return ac.localeCompare(bc);
    });
    return arr;
  }, [usersQ.data]);

  const handlePrint = useCallback(() => {
    if (typeof window !== "undefined") window.print();
  }, []);

  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: async () => loadSessionUser() ?? fetchMe(),
    initialData: loadSessionUser() ?? undefined,
    retry: false,
  });

  // List
  const shiftsQ = useQuery<Shift[]>({
    queryKey: ["shifts", tenantId],
    queryFn: () => fetchShifts(tenantId),
    enabled: Boolean(tenantId),
    retry: false,
  });

  // Single-shift query (on view)
  const [viewId, setViewId] = useState<string>("");

  // Form state
  const [unitId, setUnitId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [template, setTemplate] = useState<string>("");
  const [durationHrs, setDurationHrs] = useState<number>(8);
  const [repeatDays, setRepeatDays] = useState<number>(1);
  const [forAllUnits, setForAllUnits] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string>("");

  // Edit state
  const [editingId, setEditingId] = useState<string>("");
  const [eUnitId, setEUnitId] = useState<string>("");
  const [eUserId, setEUserId] = useState<string>("");
  const [eStart, setEStart] = useState<string>("");
  const [eEnd, setEEnd] = useState<string>("");
  const [eStatus, setEStatus] = useState<string>("");

  // Calendar state
  const [calMonth, setCalMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => startOfDay(new Date()));
  const [multiDayMode, setMultiDayMode] = useState<boolean>(false);
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);

  const viewQ = useQuery<Shift>({
    queryKey: ["shift", tenantId, viewId],
    queryFn: () => getShift(tenantId, viewId),
    enabled: Boolean(tenantId && viewId),
    retry: false,
  });

  useEffect(() => {
    if (!unitId && unitsQ.data && unitsQ.data.length > 0) setUnitId(unitsQ.data[0].id);
  }, [unitsQ.data, unitId]);

  useEffect(() => {
    if (!tenantId) return;
    if (!start) {
      const s = roundToNextQuarter(new Date());
      const e = new Date(s);
      e.setHours(e.getHours() + 8);
      setStart(toDatetimeLocalInput(s));
      setEnd(toDatetimeLocalInput(e));
    }
  }, [tenantId, start]);

  const createMut = useMutation({
    mutationFn: () => {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const nowMs = Date.now();

      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new Error("Please select valid start and end times.");
      }
      if (startDate.getTime() <= nowMs) {
        throw new Error("Start time must be in the future.");
      }
      if (endDate.getTime() <= startDate.getTime()) {
        throw new Error("End time must be after start time.");
      }

      return createShift(tenantId, {
        unit_id: unitId,
        user_id: userId || null,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts", tenantId] });
      toast({ title: "Shift created" });
      setNotes("");
    },
    onError: (err: unknown) => {
      const msg = getErrMsg(err) ?? "Failed to create shift";
      toast({ title: "Error", description: msg });
    },
  });

  const bulkCreateMut = useMutation({
    mutationFn: async (items: Array<{ unit_id: string; user_id: string | null; start_time: string; end_time: string; notes?: string }>) => {
      const tid = tenantId?.trim();
      if (!tid) throw new Error("No tenant selected");
      const nowMs = Date.now();
      for (const p of items) {
        const startTime = new Date(p.start_time);
        const endTime = new Date(p.end_time);
        if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
          throw new Error("Please select valid start and end times for every shift.");
        }
        if (startTime.getTime() <= nowMs) {
          throw new Error("All shifts must start in the future.");
        }
        if (endTime.getTime() <= startTime.getTime()) {
          throw new Error("Shift end time must be after the start time.");
        }
        // eslint-disable-next-line no-await-in-loop
        await createShift(tid, p);
      }
      return true;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts", tenantId] });
      toast({ title: "Shifts created" });
      setNotes("");
    },
    onError: (err: unknown) => {
      const msg = getErrMsg(err) ?? "Failed to create shifts";
      toast({ title: "Error", description: msg });
    },
  });

  function applyTemplate(name: string, baseDate?: Date) {
    const d = baseDate ? new Date(baseDate) : new Date();
    d.setSeconds(0, 0);

    const m = /^(\d{2})-(\d{2})$/.exec(name);
    if (m) {
      const startH = parseInt(m[1], 10);
      const endH = parseInt(m[2], 10);
      const s = new Date(d);
      s.setHours(startH, 0, 0, 0);
      const e = new Date(d);
      e.setHours(endH, 0, 0, 0);
      if (endH <= startH) e.setDate(e.getDate() + 1);
      return { start: toDatetimeLocalInput(s), end: toDatetimeLocalInput(e) };
    }

    if (name === "12h") {
      const q = roundToNextQuarter(d);
      const q2 = new Date(q);
      q2.setHours(q2.getHours() + 12);
      return { start: toDatetimeLocalInput(q), end: toDatetimeLocalInput(q2) };
    }

    if (name === "24h") {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      const y = new Date(x);
      y.setDate(y.getDate() + 1);
      return { start: toDatetimeLocalInput(x), end: toDatetimeLocalInput(y) };
    }

    return null;
  }

  const delMut = useMutation<string, unknown, { id: string }>({
    mutationFn: async ({ id }) => {
      const tid = tenantId?.trim();
      if (!tid) throw new Error("No tenant selected");

      // Step 1: probe
      const probe = await canDeleteShift(tid, id);
      if (!probe.can_delete) {
        const b = probe.blockers;
        throw new Error(
          `Shift cannot be deleted. Blockers → Swap requests: ${b.shift_swap_requests}, Assignments: ${b.assignments}, Time entries: ${b.time_entries}`
        );
      }

      // Step 2: confirm
      if (!window.confirm("Delete this shift? This cannot be undone.")) {
        throw new Error("User cancelled");
      }

      // Step 3: delete
      await deleteShift(tid, id);
      return id;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["shifts", tenantId] });
      toast({ title: "Shift deleted", description: `id=${vars.id}` });
    },
    onError: (err: unknown) => {
      const msg = getErrMsg(err) ?? "Failed to delete shift";
      toast({ title: "Error deleting shift", description: msg, variant: "destructive" });
    },
  });

  // ✅ SAFE bulk delete (single declaration)
  const bulkDelMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const tid = tenantId?.trim();
      if (!tid) throw new Error("No tenant selected");

      const blocked: Array<{ id: string; blockers: DeleteBlockers }> = [];
      const deletable: string[] = [];

      // Probe each id
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        const probe = await canDeleteShift(tid, id);
        if (probe.can_delete) deletable.push(id);
        else blocked.push({ id, blockers: probe.blockers });
      }

      if (deletable.length === 0) {
        return { deleted: [] as string[], blocked };
      }

      if (!window.confirm(`Delete ${deletable.length} shift(s)? This cannot be undone.`)) {
        throw new Error("User cancelled");
      }

      // Perform deletes
      for (const id of deletable) {
        // eslint-disable-next-line no-await-in-loop
        await deleteShift(tid, id);
      }

      return { deleted: deletable, blocked };
    },
    onSuccess: (res: { deleted: string[]; blocked: Array<{ id: string; blockers: DeleteBlockers }> }) => {
      qc.invalidateQueries({ queryKey: ["shifts", tenantId] });
      clearSelection();

      if (res.deleted.length && !res.blocked.length) {
        toast({ title: `Deleted ${res.deleted.length} shift(s)` });
        return;
      }

      const parts: string[] = [];
      if (res.deleted.length) parts.push(`Deleted: ${res.deleted.length}`);
      if (res.blocked.length) {
        const bsum = res.blocked.reduce(
          (acc, r) => {
            acc.swap += r.blockers.shift_swap_requests;
            acc.assign += r.blockers.assignments;
            acc.time += r.blockers.time_entries;
            return acc;
          },
          { swap: 0, assign: 0, time: 0 }
        );
        parts.push(
          `Blocked: ${res.blocked.length} (Swap requests: ${bsum.swap}, Assignments: ${bsum.assign}, Time entries: ${bsum.time})`
        );
      }
      toast({
        title: "Bulk delete result",
        description: parts.join(" • "),
        variant: res.blocked.length ? "destructive" : undefined,
      });
    },
    onError: (err: unknown) => {
      const msg = getErrMsg(err) ?? "Failed to delete shifts";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  // Overlap helper
  function hasMyOverlapFor(targetId: string): { conflict: boolean; conflictId?: string } {
    const list = shiftsQ.data || [];
    const target = list.find((s) => s.id === targetId);
    if (!target || !currentUserId) return { conflict: false };
    for (const s of list) {
      if (s.id === target.id) continue;
      if (s.user_id !== currentUserId) continue;
      if (overlaps(target.start_time, target.end_time, s.start_time, s.end_time)) {
        return { conflict: true, conflictId: s.id };
      }
    }
    return { conflict: false };
  }

  const takeMut = useMutation({
    mutationFn: async (id: string) => {
      const pre = hasMyOverlapFor(id);
      if (pre.conflict) {
        throw new Error("You already have a shift that overlaps this time.");
      }
      const tid = tenantId?.trim();
      if (!tid) throw new Error("Missing tenant");

      const tokenUserLatest = loadUserFromToken();
      const sessionSnapshotLatest = extractAuthSnapshot(sessionUser as SessionUser | null);
      const tokenSnapshotLatest = extractAuthSnapshot(tokenUserLatest);
      const meSnapshotLatest = extractAuthSnapshot(meQ.data);

      let uid: string | undefined = sessionSnapshotLatest.id || tokenSnapshotLatest.id || meSnapshotLatest.id;
      let email: string | undefined = sessionSnapshotLatest.email || tokenSnapshotLatest.email || meSnapshotLatest.email;

      if (!uid) {
        const me = await fetchMe().catch(() => null);
        const fetchedSnapshot = extractAuthSnapshot(me);
        uid = fetchedSnapshot.id ?? uid;
        email = fetchedSnapshot.email ?? email;
      }

      if (!uid && Array.isArray(usersQ.data)) {
        const cid = meSnapshotLatest.id;
        if (cid && usersQ.data.some((u) => u.id === cid)) uid = cid;
        if (!uid && email) {
          const norm = (s: string) => s.trim().toLowerCase();
          const e = norm(email);
          const match = usersQ.data.find((u) => (u.email ? norm(u.email) : "") === e);
          uid = match?.id;
        }
      }

      if (!uid) throw new Error("Sign in required or user not in this tenant");
      return updateShift(tid, id, { user_id: uid });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts", tenantId] });
      if (viewId) qc.invalidateQueries({ queryKey: ["shift", tenantId, viewId] });
      toast({ title: "You signed up for this shift" });
    },
    onError: (err: unknown) => {
      const msg = getErrMsg(err) ?? "Failed to take shift";
      const norm = msg.toLowerCase();
      const friendly =
        norm.includes("overlap") || norm.includes("already") || norm.includes("409")
          ? "You already have another assigned shift that overlaps this time."
          : msg;
      toast({ title: "Error", description: friendly });
    },
  });

  const releaseMut = useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error("Missing tenant");
      return updateShift(tenantId, id, { user_id: null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shifts", tenantId] });
      if (viewId) qc.invalidateQueries({ queryKey: ["shift", tenantId, viewId] });
      toast({ title: "Shift released" });
    },
    onError: (err: unknown) => {
      const msg = getErrMsg(err) ?? "Failed to release shift";
      toast({ title: "Error", description: msg });
    },
  });

  const unitMap = useMemo(() => {
    const m = new Map<string, string>();
    (unitsQ.data || []).forEach((u) => m.set(u.id, u.name));
    return m;
  }, [unitsQ.data]);

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data || []).forEach((u) => m.set(u.id, getDisplayName(u)));
    return m;
  }, [usersQ.data]);

  const sessionUser = loadSessionUser();
  const tokenUser = loadUserFromToken();

  const sessionSnapshot = extractAuthSnapshot(sessionUser);
  const tokenSnapshot = extractAuthSnapshot(tokenUser);
  const meSnapshot = extractAuthSnapshot(meQ.data);

  const currentUserId = sessionSnapshot.id || tokenSnapshot.id || meSnapshot.id || "";

  const currentEmail =
    sessionSnapshot.email ||
    tokenSnapshot.email ||
    meSnapshot.email ||
    (Array.isArray(usersQ.data) && currentUserId ? usersQ.data.find((u) => u.id === currentUserId)?.email || "" : "");

  const currentRole = (sessionSnapshot.role || meSnapshot.role || tokenSnapshot.role || "member").toLowerCase();
  const isAdminOrSched = currentRole === "admin" || currentRole === "scheduler" || currentRole === "sched";

  const [viewFilter, setViewFilter] = useState<"all" | "mine">(() => (isAdminOrSched ? "all" : "mine"));
  useEffect(() => {
    setViewFilter(isAdminOrSched ? "all" : "mine");
  }, [isAdminOrSched]);

  // --- Multi-select for bulk actions ---
  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<string>>(new Set());
  const isSelected = (id: string) => selectedShiftIds.has(id);
  const toggleSelect = (id: string) => {
    setSelectedShiftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedShiftIds(new Set());
  const selectAllFiltered = () => {
    setSelectedShiftIds(new Set((filteredShifts || []).map((s) => s.id)));
  };

  const displayName = meSnapshot.name || sessionSnapshot.name || "";
  const employeeId = meSnapshot.employee_id || sessionSnapshot.employee_id || "";
  const identityParts: string[] = [];
  if (displayName) identityParts.push(displayName);
  if (employeeId) identityParts.push(`ID: ${employeeId}`);
  if (currentEmail) identityParts.push(currentEmail);
  const identity = identityParts.join(" • ");

  const hasTenantMembership = useMemo(() => {
    if (!Array.isArray(usersQ.data)) return false;
    if (currentUserId && usersQ.data.some((u) => u.id === currentUserId)) return true;
    if (currentEmail) {
      const norm = (s: string) => s.trim().toLowerCase();
      const e = norm(currentEmail);
      if (usersQ.data.some((u) => (u.email ? norm(u.email) : "") === e)) return true;
    }
    return false;
  }, [usersQ.data, currentUserId, currentEmail]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, number>();
    const list = shiftsQ.data || [];
    if (!tenantId || list.length === 0) return map;

    const monthStart = startOfMonth(calMonth);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    for (const s of list) {
      const sd = new Date(s.start_time);
      if (sd < monthStart || sd > monthEnd) continue;
      const key = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, "0")}-${String(sd.getDate()).padStart(2, "0")}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [shiftsQ.data, calMonth, tenantId]);

  const shiftsByDate = useMemo(() => {
    const rec: Record<string, DayShift[]> = {};
    const list = shiftsQ.data || [];
    for (const s of list) {
      const sd = new Date(s.start_time);
      const key = `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, "0")}-${String(sd.getDate()).padStart(2, "0")}`;
      const assigned = Boolean(s.user_id);
      const explicitColor = s.color ?? null;
      const color = explicitColor ?? (assigned ? "#2563eb" : "#f59e0b");

      const item: DayShift = {
        id: s.id,
        unitName: s.unit_id ? unitMap.get(s.unit_id) ?? null : null,
        userName: s.user_id ? userMap.get(s.user_id) ?? null : null,
        start: s.start_time,
        end: s.end_time,
        color,
      };
      (rec[key] ||= []).push(item);
    }
    return rec;
  }, [shiftsQ.data, unitMap, userMap]);

  const filteredShifts = useMemo(() => {
    const list = shiftsQ.data || [];
    const byDate = selectedDate ? list.filter((s) => sameDay(new Date(s.start_time), selectedDate)) : list;
    if (isAdminOrSched || viewFilter === "all") return byDate;
    return byDate.filter((s) => s.user_id === currentUserId);
  }, [shiftsQ.data, selectedDate, isAdminOrSched, viewFilter, currentUserId]);

  const startDateValue = start ? new Date(start) : null;
  const endDateValue = end ? new Date(end) : null;
  const startOk = !!(startDateValue && !Number.isNaN(startDateValue.getTime()));
  const endOk = !!(endDateValue && !Number.isNaN(endDateValue.getTime()));
  const nowMs = Date.now();
  const startInFuture = startOk && startDateValue ? startDateValue.getTime() > nowMs : false;
  const endAfterStart = startOk && endOk && startDateValue && endDateValue ? endDateValue.getTime() > startDateValue.getTime() : false;
  const canCreate = Boolean(tenantId && unitId && startOk && endOk && startInFuture && endAfterStart);

  function renderViewPanelBody() {
    if (!tenantId) return <div className="text-sm text-muted-foreground">Set a Tenant ID above.</div>;
    if (viewQ.isLoading) {
      return (
        <div className="space-y-2">
          <div className="animate-pulse h-4 w-48 bg-muted rounded" />
          <div className="animate-pulse h-3 w-72 bg-muted rounded" />
          <div className="animate-pulse h-3 w-40 bg-muted rounded" />
        </div>
      );
    }
    if (viewQ.isError) {
      const msg = getErrMsg(viewQ.error) || "Failed to load shift";
      return <div className="text-sm text-red-600">{msg}</div>;
    }
    if (viewQ.data) {
      return (
        <div className="space-y-1 text-sm">
          <div className="font-medium">
            {viewQ.data.unit_id ? unitMap.get(viewQ.data.unit_id) ?? "Unit" : "Unit"}{" • "}
            {viewQ.data.user_id ? userMap.get(viewQ.data.user_id) ?? "User" : "Unassigned"}
          </div>
          <div className="opacity-80">
            {new Date(viewQ.data.start_time).toLocaleString()} → {new Date(viewQ.data.end_time).toLocaleString()}
          </div>
          {viewQ.data.notes && <div>{viewQ.data.notes}</div>}
          <div className="opacity-60">
            ID: <code>{viewQ.data.id}</code>
          </div>
          <div className="pt-2">
            <ClockControls
              currentUserId={currentUserId}
              currentUserRole={currentRole as any}
              shiftId={viewQ.data.id}
              assignedUserId={viewQ.data.user_id || null}
            />
          </div>
        </div>
      );
    }
    return null;
  }

  function renderListBody() {
    if (!tenantId) return <div className="text-sm text-muted-foreground">Set a Tenant ID above to load shifts.</div>;
    if (shiftsQ.isLoading) {
      return (
        <ul className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="flex items-center justify-between border rounded-md px-3 py-2 hover:bg-muted/50 transition"
            >
              <div className="space-y-2 w-full">
                <div className="animate-pulse h-3 w-40 bg-muted rounded" />
                <div className="animate-pulse h-3 w-64 bg-muted rounded" />
              </div>
              <div className="flex items-center gap-2">
                <div className="animate-pulse h-6 w-16 bg-muted rounded" />
                <div className="animate-pulse h-6 w-16 bg-muted rounded" />
              </div>
            </li>
          ))}
        </ul>
      );
    }
    if (shiftsQ.isError) {
      const msg = getErrMsg(shiftsQ.error) || "Failed to load shifts";
      return <div className="text-red-600 text-sm">{msg}</div>;
    }
    if (filteredShifts.length === 0) {
      return (
        <div className="text-muted-foreground text-sm">
          {selectedDate ? "No shifts on the selected date." : "No shifts yet."}
        </div>
      );
    }
    return (
      <>
        {selectedDate && (
          <div className="mb-2 flex items-center justify-between text-sm">
            <div className="text-muted-foreground">Filtered by date: {selectedDate.toLocaleDateString()}</div>
            <Button variant="outline" size="sm" onClick={() => setSelectedDate(null)} className="print:hidden">
              Clear filter
            </Button>
          </div>
        )}
        <ul className="space-y-2">
          {filteredShifts.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between border rounded-md px-3 py-2 hover:bg-muted/50 transition"
            >
              <div className="flex items-start gap-3 w-full">
                {isAdminOrSched && (
                  <input
                    type="checkbox"
                    className="mt-1 print:hidden"
                    checked={isSelected(s.id)}
                    onChange={() => toggleSelect(s.id)}
                    aria-label={`Select shift ${s.id}`}
                  />
                )}
                <div className="space-y-0.5 flex-1">
                  <div className="font-medium flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs border" title="Unit">
                      {s.unit_id ? unitMap.get(s.unit_id) ?? "Unit" : "Unit"}
                    </span>
                    {s.user_id ? (
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs border bg-emerald-50">
                        {userMap.get(s.user_id) ?? "Assigned"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded px-2 py-0.5 text-xs border bg-amber-50">
                        Unassigned
                      </span>
                    )}
                  </div>
                  <div className="text-sm opacity-80">
                    {new Date(s.start_time).toLocaleString()} → {new Date(s.end_time).toLocaleString()}
                  </div>
                  {s.notes && <div className="text-sm">{s.notes}</div>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 text-right md:flex-row md:items-center md:gap-2 md:text-left">
                <code className="opacity-60 print:opacity-90">{s.id.slice(0, 8)}…</code>

                <div className="flex items-center gap-2 print:hidden">
                  {isAdminOrSched ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingId(s.id);
                          setEUnitId(s.unit_id || "");
                          setEUserId(s.user_id || "");
                          setEStart(toDatetimeLocalInput(new Date(s.start_time)));
                          setEEnd(toDatetimeLocalInput(new Date(s.end_time)));
                          setEStatus(s.status || "");
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setViewId(s.id)}>
                        View
                      </Button>
                      {/* Row delete — confirm happens inside mutation */}
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={delMut.isPending && deletingId === s.id}
                        onClick={() => {
                          setDeletingId(s.id);
                          delMut.mutate({ id: s.id }, { onSettled: () => setDeletingId("") });
                          setSelectedShiftIds((prev) => {
                            const n = new Set(prev);
                            n.delete(s.id);
                            return n;
                          });
                        }}
                      >
                        {delMut.isPending && deletingId === s.id ? "Deleting…" : "Delete"}
                      </Button>

                      {!s.user_id && (
                        <Button
                          variant="default"
                          size="sm"
                          disabled={takeMut.isPending}
                          onClick={() => {
                            const pre = hasMyOverlapFor(s.id);
                            if (pre.conflict) {
                              toast({ title: "Overlap", description: "You already have a shift that overlaps this time." });
                              return;
                            }
                            takeMut.mutate(s.id);
                          }}
                        >
                          {takeMut.isPending ? "Taking…" : "Sign up"}
                        </Button>
                      )}
                      {s.user_id === currentUserId && (
                        <Button variant="outline" size="sm" disabled={releaseMut.isPending} onClick={() => releaseMut.mutate(s.id)}>
                          {releaseMut.isPending ? "Releasing…" : "Release"}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      {!s.user_id && (
                        <Button
                          variant="default"
                          size="sm"
                          disabled={takeMut.isPending}
                          onClick={() => {
                            const pre = hasMyOverlapFor(s.id);
                            if (pre.conflict) {
                              toast({ title: "Overlap", description: "You already have a shift that overlaps this time." });
                              return;
                            }
                            takeMut.mutate(s.id);
                          }}
                        >
                          {takeMut.isPending ? "Taking…" : "Sign up"}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <RequireAuth>
      <div className="mx-auto max-w-6xl px-4 space-y-6 print:space-y-4 print:bg-white print:text-black">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold print:text-black">Shifts</h1>
          <Button type="button" variant="outline" size="sm" onClick={handlePrint} className="print:hidden">
            Print shifts
          </Button>
        </div>

        {/* Tenant Selector */}
        <Card className="p-4 space-y-2 bg-muted/50 print:hidden">
          <div className="font-medium">Tenant</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const value = tenantId.trim();
              if (!value) return;
              localStorage.setItem("tenant_id", value);
              toast({ title: "Tenant set", description: `Using tenant ${value}` });
              qc.invalidateQueries({ queryKey: ["units-picker", value] });
              qc.invalidateQueries({ queryKey: ["users-picker", value] });
              qc.invalidateQueries({ queryKey: ["shifts", value] });
            }}
            className="flex gap-2"
          >
            <Input placeholder="Tenant ID (UUID)" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
            <Button type="submit" variant="outline" className="h-9">
              Save
            </Button>
          </form>
          {!tenantId && <p className="text-sm text-muted-foreground">Paste your tenant UUID and click Save to load shifts.</p>}
        </Card>

        {/* Calendar */}
        <Card className="p-4 space-y-3 bg-muted/30 print:hidden">
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground print:text-black">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#2563eb" }} />
              Shift
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
              Unassigned
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded border-2" style={{ borderColor: "hsl(var(--primary))" }} />
              Today
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded border-2"
                style={{ borderColor: "hsl(var(--ring))", background: "hsl(var(--accent))" }}
              />
              Selected
            </span>
          </div>

          <Calendar
            month={calMonth}
            onMonthChange={setCalMonth}
            selectedDate={selectedDate}
            selectedDates={selectedDates}
            onSelect={(day) => {
              setSelectedDate(day);

              if (multiDayMode && day) {
                setSelectedDates((prev) => {
                  const exists = hasDate(prev, day);
                  if (exists) return prev.filter((d) => ymd(d) !== ymd(day));
                  return [...prev, startOfDay(day)];
                });
              } else {
                setSelectedDates([startOfDay(day)]);
              }

              if (template) {
                const applied = applyTemplate(template, day);
                if (applied) {
                  setStart(applied.start);
                  setEnd(applied.end);
                  const ms = new Date(applied.end).getTime() - new Date(applied.start).getTime();
                  const hrs = Math.max(1, Math.round(ms / 36e5));
                  setDurationHrs(hrs);
                  return;
                }
              }
              const s = new Date(day);
              s.setHours(9, 0, 0, 0);
              const e = new Date(s);
              const len = Number.isFinite(durationHrs) ? Number(durationHrs) : 8;
              e.setHours(e.getHours() + len);
              setStart(toDatetimeLocalInput(s));
              setEnd(toDatetimeLocalInput(e));
            }}
            shiftsByDate={shiftsByDate}
            loading={shiftsQ.isLoading}
            printable
          />

          {/* Selected date quick actions */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-sm">
              <div>
                {selectedDate
                  ? `Selected: ${selectedDate.toLocaleDateString()}`
                  : "Select a day to filter or prefill the form."}
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={multiDayMode}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setMultiDayMode(on);
                    if (!on && selectedDates.length > 0) {
                      setSelectedDates([selectedDates[selectedDates.length - 1]]);
                    }
                  }}
                />
                Multi-day select
              </label>
              {multiDayMode && (
                <span className="inline-flex items-center gap-1 rounded border px-2 py-0.5 bg-muted text-xs">
                  {selectedDates.length} day(s)
                  <button type="button" className="underline" onClick={() => setSelectedDates([])} title="Clear selected days">
                    Clear
                  </button>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!selectedDate) return;
                  const s = new Date(selectedDate);
                  s.setHours(9, 0, 0, 0);
                  const e = new Date(s);
                  e.setHours(e.getHours() + 8);
                  setStart(toDatetimeLocalInput(s));
                  setEnd(toDatetimeLocalInput(e));
                }}
              >
                Prefill day (9–17)
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setSelectedDate(null); setSelectedDates([]); }}>
                Clear
              </Button>
            </div>
          </div>
        </Card>

        {/* Create */}
        <Card className="p-4 space-y-3 bg-muted/50 print:hidden">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-2">
              <Label>Unit</Label>
              <select
                aria-label="Unit"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                disabled={unitsQ.isLoading || !tenantId}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
              >
                <option value="" disabled>
                  Select unit
                </option>
                {(unitsQ.data || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-3">
              <Label>User (optional)</Label>
              <select
                aria-label="User (optional)"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                disabled={usersQ.isLoading || !tenantId}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50"
              >
                <option value="">(Unassigned)</option>
                {usersSorted.map((u) => {
                  const name = getDisplayName(u);
                  const emp = getEmployeeId(u);
                  const cred = getPrimaryCredential(u);
                  const label = [name, emp, cred].filter(Boolean).join(" · ");
                  return (
                    <option key={u.id} value={u.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="md:col-span-3">
              <Label>Start</Label>
              <Input
                type="datetime-local"
                value={start}
                onChange={(e) => {
                  const v = e.target.value;
                  setStart(v);
                  if (end && new Date(end) <= new Date(v)) {
                    const s = new Date(v);
                    s.setHours(s.getHours() + 8);
                    setEnd(toDatetimeLocalInput(s));
                  }
                }}
              />
            </div>

            <div className="md:col-span-3">
              <Label>End</Label>
              <Input type="datetime-local" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
            </div>

            {/* Template & Duration */}
            <div className="md:col-span-3">
              <Label>Template</Label>
              <select
                aria-label="Template"
                value={template}
                onChange={(e) => {
                  const val = e.target.value;
                  setTemplate(val);
                  const base = selectedDate ? new Date(selectedDate) : new Date();
                  const applied = applyTemplate(val, base);
                  if (applied) {
                    setStart(applied.start);
                    setEnd(applied.end);
                    const ms = new Date(applied.end).getTime() - new Date(applied.start).getTime();
                    const hrs = Math.max(1, Math.round(ms / 36e5));
                    setDurationHrs(hrs);
                  }
                }}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">(none)</option>
                <option value="07-19">07:00 – 19:00</option>
                <option value="19-07">19:00 – 07:00</option>
                <option value="10-19">10:00 – 19:00</option>
                <option value="19-06">19:00 – 06:00</option>
                <option value="12h">12 hours (from next quarter)</option>
                <option value="24h">24 hours (full day)</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <Label>Duration (hours)</Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={durationHrs}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(24, Number(e.target.value || 0)));
                  setDurationHrs(v);
                  if (start) {
                    const s = new Date(start);
                    const e2 = new Date(s);
                    e2.setHours(e2.getHours() + v);
                    setEnd(toDatetimeLocalInput(e2));
                  }
                }}
              />
            </div>

            <div className="md:col-span-3">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>

            {/* Repeat & All Units */}
            <div className="md:col-span-2">
              <Label>Repeat (days)</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={repeatDays}
                onChange={(e) => setRepeatDays(Math.max(1, Math.min(31, Number(e.target.value || 1))))}
              />
            </div>
            <div className="flex items-center gap-2 md:col-span-2 pt-6">
              <input id="forAllUnits" type="checkbox" checked={forAllUnits} onChange={(e) => setForAllUnits(e.target.checked)} />
              <label htmlFor="forAllUnits" className="text-sm">
                Create for all units
              </label>
            </div>
          </div>

          <div>
            <Button
              onClick={() => {
                const tid = tenantId?.trim();
                if (!tid) return;

                const units = forAllUnits ? (unitsQ.data || []).map((u) => u.id) : [unitId];
                const startDate = new Date(start);
                const endDate = new Date(end);
                const nowMs = Date.now();

                if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
                  toast({ title: "Invalid date", description: "Please select valid start and end times." });
                  return;
                }
                if (startDate.getTime() <= nowMs) {
                  toast({ title: "Start time is in the past", description: "Please select a future date and time." });
                  return;
                }
                if (endDate.getTime() <= startDate.getTime()) {
                  toast({ title: "End time before start", description: "End time must be after the start time." });
                  return;
                }

                const items: Array<{
                  unit_id: string;
                  user_id: string | null;
                  start_time: string;
                  end_time: string;
                  notes?: string;
                }> = [];

                if (multiDayMode && selectedDates.length > 0) {
                  for (const uid of units) {
                    for (const d of selectedDates) {
                      const s = new Date(d);
                      const e2 = new Date(d);
                      const sSrc = new Date(startDate);
                      const eSrc = new Date(endDate);
                      s.setHours(sSrc.getHours(), sSrc.getMinutes(), 0, 0);
                      e2.setHours(eSrc.getHours(), eSrc.getMinutes(), 0, 0);
                      if (e2.getTime() <= s.getTime()) e2.setDate(e2.getDate() + 1);
                      items.push({
                        unit_id: uid,
                        user_id: userId || null,
                        start_time: s.toISOString(),
                        end_time: e2.toISOString(),
                        notes: notes || undefined,
                      });
                    }
                  }
                } else if (repeatDays > 1 || forAllUnits) {
                  for (const uid of units) {
                    for (let i = 0; i < repeatDays; i++) {
                      const s = new Date(startDate);
                      s.setDate(s.getDate() + i);
                      const e2 = new Date(endDate);
                      e2.setDate(e2.getDate() + i);
                      items.push({
                        unit_id: uid,
                        user_id: userId || null,
                        start_time: s.toISOString(),
                        end_time: e2.toISOString(),
                        notes: notes || undefined,
                      });
                    }
                  }
                }

                if (items.length > 0) {
                  const hasPast = items.some((item) => {
                    const ts = new Date(item.start_time).getTime();
                    return Number.isNaN(ts) || ts <= nowMs;
                  });
                  if (hasPast) {
                    toast({
                      title: "Shift time is in the past",
                      description: "Please adjust your selection so all shifts start in the future.",
                    });
                    return;
                  }
                  bulkCreateMut.mutate(items);
                } else {
                  createMut.mutate();
                }
              }}
              disabled={!canCreate || createMut.isPending || bulkCreateMut.isPending}
            >
              {createMut.isPending || bulkCreateMut.isPending
                ? "Creating..."
                : repeatDays > 1 || forAllUnits
                ? `Create ${forAllUnits ? (unitsQ.data || []).length : 1} × ${repeatDays}`
                : "Create Shift"}
            </Button>
            {(!tenantId || !unitId || !start || !end) && (
              <div className="text-xs text-muted-foreground mt-2">
                {!tenantId
                  ? "Set a Tenant ID above to enable creation."
                  : !unitId
                  ? "Create a Unit first or select an existing one."
                  : !start || !end
                  ? "Pick start and end times."
                  : null}
              </div>
            )}
            {multiDayMode && (
              <div className="text-xs text-muted-foreground mt-2">
                Multi-day mode: the <em>Repeat (days)</em> setting is ignored; we will create one shift per selected day.
              </div>
            )}
            {tenantId && unitId && start && end && (
              <>
                {!startOk || !endOk ? (
                  <div className="text-xs text-red-600 mt-2">Invalid date/time format.</div>
                ) : !startInFuture ? (
                  <div className="text-xs text-red-600 mt-2">Start time must be in the future.</div>
                ) : !endAfterStart ? (
                  <div className="text-xs text-red-600 mt-2">End time must be after start time.</div>
                ) : null}
              </>
            )}
            {(repeatDays > 1 || forAllUnits) && (
              <div className="text-xs text-muted-foreground mt-2">
                Bulk mode: {forAllUnits ? "all units" : "one unit"} × {repeatDays} day(s).
              </div>
            )}
          </div>
        </Card>

        {/* Edit (appears when a row is selected) */}
        {editingId && (
          <Card className="p-4 space-y-3 bg-muted/50 print:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">Edit Shift</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingId("");
                  setEUnitId("");
                  setEUserId("");
                  setEStart("");
                  setEEnd("");
                  setEStatus("");
                }}
              >
                Cancel
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
              <div>
                <Label>Unit</Label>
                <select
                  value={eUnitId}
                  onChange={(e) => setEUnitId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">(leave unchanged)</option>
                  {(unitsQ.data || []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label>User</Label>
                <select
                  value={eUserId}
                  onChange={(e) => setEUserId(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">(leave unchanged)</option>
                  <option value="__UNASSIGN__">(Unassigned)</option>
                  {usersSorted.map((u) => {
                    const name = getDisplayName(u);
                    const emp = getEmployeeId(u);
                    const cred = getPrimaryCredential(u);
                    const label = [name, emp, cred].filter(Boolean).join(" · ");
                    return (
                      <option key={u.id} value={u.id}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <Label>Start</Label>
                <Input type="datetime-local" value={eStart} onChange={(e) => setEStart(e.target.value)} placeholder="(leave blank to keep current)" />
              </div>

              <div>
                <Label>End</Label>
                <Input type="datetime-local" value={eEnd} onChange={(e) => setEEnd(e.target.value)} />
              </div>

              <div>
                <Label>Status</Label>
                <Input value={eStatus} onChange={(e) => setEStatus(e.target.value)} placeholder="e.g. draft/published (leave blank to keep current)" />
              </div>

              <div className="flex items-end">
                <Button onClick={() => updateMut.mutate()} disabled={!tenantId || !editingId || updateMut.isPending}>
                  {updateMut.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* View details */}
        {viewId && (
          <Card className="p-4 space-y-2 bg-muted/30 print:hidden">
            <div className="flex items-center justify-between">
              <div className="font-medium">Shift Details</div>
              <Button type="button" variant="outline" size="sm" onClick={() => setViewId("")}>
                Close
              </Button>
            </div>
            {renderViewPanelBody()}
          </Card>
        )}

        {/* List */}
        <Card className="p-4 bg-muted/30 space-y-3 print:bg-white print:text-black print:shadow-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="font-medium">Shifts</div>

              {isAdminOrSched && (
                <label className="flex items-center gap-2 text-sm print:hidden">
                  <input
                    type="checkbox"
                    checked={filteredShifts.length > 0 && selectedShiftIds.size === filteredShifts.length}
                    onChange={(e) => {
                      if (e.target.checked) selectAllFiltered();
                      else clearSelection();
                    }}
                  />
                  Select all on page
                </label>
              )}

              {isAdminOrSched && selectedShiftIds.size > 0 && (
                <span className="text-xs text-muted-foreground print:hidden">{selectedShiftIds.size} selected</span>
              )}
            </div>

            <div className="flex items-center gap-2 print:hidden">
              {!isAdminOrSched ? (
                <div className="inline-flex rounded-md border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setViewFilter("mine")}
                    className={`px-3 py-1 text-sm ${viewFilter === "mine" ? "bg-background" : "bg-muted"}`}
                    title="Only shifts you are assigned to"
                  >
                    My shifts
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewFilter("all")}
                    className={`px-3 py-1 text-sm ${viewFilter === "all" ? "bg-background" : "bg-muted"}`}
                    title="All shifts in this tenant"
                  >
                    All shifts
                  </button>
                </div>
              ) : (
                <>
                  {selectedShiftIds.size > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={bulkDelMut.isPending}
                      onClick={() => {
                        const ids = Array.from(selectedShiftIds);
                        bulkDelMut.mutate(ids);
                      }}
                    >
                      {bulkDelMut.isPending ? "Deleting…" : `Delete ${selectedShiftIds.size} selected`}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          {renderListBody()}
        </Card>
      </div>
    </RequireAuth>
  );
}

// Inline Label component
function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-sm font-medium">{children}</label>;
}