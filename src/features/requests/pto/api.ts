import { api } from "@/lib/api";

export type PtoRequestStatus = "pending" | "approved" | "denied" | "cancelled" | "canceled";
export type PtoCategory = "pto" | "vacation" | "sick" | "unpaid" | "other";

type RawUser = {
  id?: string;
  email?: string | null;
  employee_id?: string | null;
  name?: string | null;
};

type RawPtoRequest = {
  id?: string;
  request_id?: string;
  user_id?: string;
  user?: RawUser | null;
  employee_id?: string | null;
  email?: string | null;
  name?: string | null;
  tenant_id?: string | null;
  category?: string | null;
  type?: string | null;
  status?: string | null;
  start?: string | null;
  start_date?: string | null;
  start_time?: string | null;
  end?: string | null;
  end_date?: string | null;
  end_time?: string | null;
  hours?: number | string | null;
  total_hours?: number | string | null;
  notes?: string | null;
  reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PtoRequest = {
  id: string;
  userId: string;
  userName: string;
  userEmail?: string | null;
  employeeId?: string | null;
  tenantId?: string | null;
  type: PtoCategory;
  status: PtoRequestStatus;
  start: string;
  end: string;
  hours: number;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

function normalizeType(value?: string | null): PtoCategory {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("vacation")) return "vacation";
  if (normalized.includes("sick")) return "sick";
  if (normalized.includes("unpaid")) return "unpaid";
  if (!normalized || normalized.includes("pto")) return "pto";
  return "other";
}

function normalizeStatus(value?: string | null): PtoRequestStatus {
  const normalized = (value || "").toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "denied") return "denied";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  return "pending";
}

function safeHours(value?: number | string | null): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickDate(primary?: string | null, fallback?: string | null, time?: string | null): string {
  const first = primary || fallback || "";
  if (!first) return new Date().toISOString();
  if (time && !first.includes("T")) {
    const attempt = `${first}T${time}`;
    const d = new Date(attempt);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(first);
  if (Number.isNaN(d.getTime())) return new Date(first).toISOString();
  return d.toISOString();
}

function resolveName(raw: RawPtoRequest): string {
  const direct = (raw.name || "").trim();
  if (direct) return direct;
  const nested = (raw.user?.name || "").trim();
  if (nested) return nested;
  const email = (raw.email || raw.user?.email || "").trim();
  if (email) {
    const base = email.includes("@") ? email.split("@")[0] : email;
    if (base) return base;
  }
  const employeeId = raw.employee_id || raw.user?.employee_id;
  if (employeeId) return String(employeeId);
  return "Unknown";
}

function resolveUserId(raw: RawPtoRequest): string {
  return String(raw.user_id || raw.request_id || raw.id || "");
}

function normalizePto(raw: RawPtoRequest): PtoRequest {
  const start = pickDate(raw.start, raw.start_date, raw.start_time);
  const end = pickDate(raw.end, raw.end_date, raw.end_time);
  return {
    id: String(raw.id || raw.request_id || crypto.randomUUID?.() || Math.random().toString(36).slice(2)),
    userId: resolveUserId(raw),
    userName: resolveName(raw),
    userEmail: raw.email ?? raw.user?.email ?? null,
    employeeId: raw.employee_id ?? raw.user?.employee_id ?? null,
    tenantId: raw.tenant_id ?? null,
    type: normalizeType(raw.type || raw.category),
    status: normalizeStatus(raw.status),
    start,
    end,
    hours: safeHours(raw.hours ?? raw.total_hours ?? 0),
    notes: raw.notes ?? raw.reason ?? null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  };
}

export async function fetchPtoRequests(tenantId: string): Promise<PtoRequest[]> {
  if (!tenantId) return [];
  const { data } = await api.get<RawPtoRequest[]>("/pto", {
    params: { tenant_id: tenantId },
  });
  if (!Array.isArray(data)) return [];
  return data.map((item) => normalizePto(item ?? {}));
}

export async function createPtoRequest(
  tenantId: string,
  payload: {
    userId: string;
    start: string;
    end: string;
    hours: number;
    type: PtoCategory;
    notes?: string;
  }
): Promise<PtoRequest> {
  const body = {
    user_id: payload.userId,
    start: payload.start,
    end: payload.end,
    hours: payload.hours,
    type: payload.type,
    notes: payload.notes,
  };
  const { data } = await api.post<RawPtoRequest>("/pto", body, {
    params: { tenant_id: tenantId },
  });
  return normalizePto(data ?? {});
}

export async function updatePtoStatus(
  tenantId: string,
  id: string,
  status: Exclude<PtoRequestStatus, "pending">,
  notes?: string
): Promise<PtoRequest> {
  const body = { status, notes };
  const { data } = await api.patch<RawPtoRequest>(`/pto/${id}`, body, {
    params: { tenant_id: tenantId },
  });
  return normalizePto(data ?? {});
}

export async function deletePtoRequest(tenantId: string, id: string): Promise<string> {
  await api.delete(`/pto/${id}`, { params: { tenant_id: tenantId } });
  return id;
}

export const approvePtoRequest = (tenantId: string, id: string) => updatePtoStatus(tenantId, id, "approved");
export const denyPtoRequest = (tenantId: string, id: string, notes?: string) =>
  updatePtoStatus(tenantId, id, "denied", notes);
export const cancelPtoRequest = (tenantId: string, id: string, notes?: string) =>
  updatePtoStatus(tenantId, id, "cancelled", notes);
