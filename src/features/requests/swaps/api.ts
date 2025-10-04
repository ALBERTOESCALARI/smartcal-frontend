import { api } from "@/lib/api";

export type SwapRequestStatus = "pending" | "approved" | "declined" | "cancelled" | "canceled";

type RawUser = {
  id?: string;
  email?: string | null;
  employee_id?: string | null;
  name?: string | null;
};

type RawSwapRequest = {
  id?: string;
  request_id?: string;
  shift_id?: string;
  tenant_id?: string | null;
  status?: string | null;
  notes?: string | null;
  reason?: string | null;
  requested_by?: string | null;
  requester_id?: string | null;
  requestor_id?: string | null;
  from_user_id?: string | null;
  from_user?: RawUser | null;
  to_user_id?: string | null;
  to_user?: RawUser | null;
  target_user_id?: string | null;
  target_user?: RawUser | null;
  created_at?: string | null;
  updated_at?: string | null;
  shift?: {
    id?: string;
    start_time?: string | null;
    end_time?: string | null;
    unit_id?: string | null;
    unit_name?: string | null;
  } | null;
  start_time?: string | null;
  end_time?: string | null;
  unit_id?: string | null;
  unit_name?: string | null;
};

export type SwapRequest = {
  id: string;
  shiftId?: string | null;
  tenantId?: string | null;
  status: SwapRequestStatus;
  fromUserId: string;
  fromUserName: string;
  fromUserEmail?: string | null;
  targetUserId?: string | null;
  targetUserName?: string | null;
  targetUserEmail?: string | null;
  notes?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  shiftUnit?: string | null;
};

function normalizeStatus(value?: string | null): SwapRequestStatus {
  const normalized = (value || "").toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "declined" || normalized === "denied") return "declined";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  return "pending";
}

function resolveUserName(user?: RawUser | null, fallbackEmail?: string | null): string {
  const name = (user?.name || "").trim();
  if (name) return name;
  const email = (user?.email || fallbackEmail || "").trim();
  if (email) {
    const base = email.includes("@") ? email.split("@")[0] : email;
    if (base) return base;
  }
  const employeeId = user?.employee_id;
  if (employeeId) return String(employeeId);
  return "Unknown";
}

function safeIso(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function normalizeSwap(raw: RawSwapRequest): SwapRequest {
  const fromUser = raw.from_user ?? raw.to_user ?? raw.target_user;
  const targetUser = raw.target_user ?? raw.to_user;
  const fromId =
    raw.from_user_id ||
    raw.requested_by ||
    raw.requester_id ||
    raw.requestor_id ||
    fromUser?.id ||
    "";
  const targetId = raw.target_user_id || raw.to_user_id || targetUser?.id || null;

  const shift = raw.shift ?? null;
  const shiftStart = safeIso(shift?.start_time ?? raw.start_time ?? null);
  const shiftEnd = safeIso(shift?.end_time ?? raw.end_time ?? null);
  const shiftUnit = shift?.unit_name ?? raw.unit_name ?? null;

  return {
    id: String(raw.id || raw.request_id || crypto.randomUUID?.() || Math.random().toString(36).slice(2)),
    shiftId: raw.shift_id || shift?.id || null,
    tenantId: raw.tenant_id ?? null,
    status: normalizeStatus(raw.status),
    fromUserId: String(fromId),
    fromUserName: resolveUserName(fromUser, raw.from_user?.email),
    fromUserEmail: fromUser?.email ?? null,
    targetUserId: targetId ? String(targetId) : null,
    targetUserName: targetId ? resolveUserName(targetUser) : null,
    targetUserEmail: targetUser?.email ?? null,
    notes: raw.notes ?? raw.reason ?? null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
    shiftStart,
    shiftEnd,
    shiftUnit,
  };
}

export async function fetchSwapRequests(tenantId: string): Promise<SwapRequest[]> {
  if (!tenantId) return [];
  const { data } = await api.get<RawSwapRequest[]>("/api/swaps", {
    params: { tenant_id: tenantId },
  });
  if (!Array.isArray(data)) return [];
  return data.map((item) => normalizeSwap(item ?? {}));
}

export async function createSwapRequest(
  tenantId: string,
  payload: {
    shiftId: string;
    fromUserId: string;
    targetUserId?: string | null;
    notes?: string;
  }
): Promise<SwapRequest> {
  const body = {
    shift_id: payload.shiftId,
    from_user_id: payload.fromUserId,
    target_user_id: payload.targetUserId,
    notes: payload.notes,
  };
  const { data } = await api.post<RawSwapRequest>("/api/swaps", body, {
    params: { tenant_id: tenantId },
  });
  return normalizeSwap(data ?? {});
}

export async function updateSwapStatus(
  tenantId: string,
  id: string,
  status: Exclude<SwapRequestStatus, "pending">,
  options?: { targetUserId?: string | null; notes?: string | null }
): Promise<SwapRequest> {
  const body = {
    status,
    target_user_id: options?.targetUserId,
    notes: options?.notes,
  };
  const { data } = await api.patch<RawSwapRequest>(`/api/swaps/${id}`, body, {
    params: { tenant_id: tenantId },
  });
  return normalizeSwap(data ?? {});
}

export async function deleteSwapRequest(tenantId: string, id: string): Promise<string> {
  await api.delete(`/api/swaps/${id}`, { params: { tenant_id: tenantId } });
  return id;
}

export const approveSwapRequest = (
  tenantId: string,
  id: string,
  options?: { targetUserId?: string | null; notes?: string | null }
) => updateSwapStatus(tenantId, id, "approved", options);

export const declineSwapRequest = (
  tenantId: string,
  id: string,
  notes?: string | null
) => updateSwapStatus(tenantId, id, "declined", { notes });

export const cancelSwapRequest = (
  tenantId: string,
  id: string,
  notes?: string | null
) => updateSwapStatus(tenantId, id, "cancelled", { notes });