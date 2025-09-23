import { api } from "@/lib/api";

export type UserHourSummary = {
  userId: string;
  name: string;
  email?: string | null;
  employeeId?: string | null;
  regularHours: number;
  overtimeHours: number;
  ptoHours: number;
  sickHours: number;
  vacationHours: number;
  accruals: {
    pto: number;
    sick: number;
    vacation: number;
  };
};

type RawUser = {
  id?: string;
  user_id?: string;
  email?: string | null;
  employee_id?: string | null;
  name?: string | null;
};

type RawHourEntry = {
  id?: string;
  user_id?: string;
  user?: RawUser | null;
  employee_id?: string | null;
  email?: string | null;
  name?: string | null;
  regular_hours?: number | string | null;
  regular?: number | string | null;
  worked_hours?: number | string | null;
  overtime_hours?: number | string | null;
  overtime?: number | string | null;
  over_time_hours?: number | string | null;
  pto_hours?: number | string | null;
  pto?: number | string | null;
  sick_hours?: number | string | null;
  sick?: number | string | null;
  vacation_hours?: number | string | null;
  vacation?: number | string | null;
  accruals?: {
    pto?: number | string | null;
    sick?: number | string | null;
    vacation?: number | string | null;
  } | null;
  pto_accrued?: number | string | null;
  sick_accrued?: number | string | null;
  vacation_accrued?: number | string | null;
};

type RawUserFallback = {
  id?: string;
  email?: string | null;
  employee_id?: string | null;
  name?: string | null;
};

function safeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resolveName(entry: RawHourEntry): string {
  const direct = (entry.name || "").trim();
  if (direct) return direct;
  const nested = (entry.user?.name || "").trim();
  if (nested) return nested;
  const email = (entry.email || entry.user?.email || "").trim();
  if (email) {
    const base = email.includes("@") ? email.split("@")[0] : email;
    if (base) return base;
  }
  const employeeId = entry.employee_id || entry.user?.employee_id;
  if (employeeId) return String(employeeId);
  return "Unknown";
}

function resolveUserId(entry: RawHourEntry, fallbackIndex: number): string {
  const fromEntry = entry.user_id || entry.id;
  if (fromEntry) return String(fromEntry);
  const nested = entry.user?.id;
  if (nested) return String(nested);
  return `__missing-${fallbackIndex}`;
}

function resolveAccrual(value?: number | string | null): number {
  return safeNumber(value ?? 0);
}

function normalizeEntry(entry: RawHourEntry, index: number): UserHourSummary {
  const accruals = entry.accruals || {};
  return {
    userId: resolveUserId(entry, index),
    name: resolveName(entry),
    email: entry.email ?? entry.user?.email ?? null,
    employeeId: entry.employee_id ?? entry.user?.employee_id ?? null,
    regularHours:
      safeNumber(entry.regular_hours ?? entry.regular ?? entry.worked_hours ?? 0),
    overtimeHours:
      safeNumber(entry.overtime_hours ?? entry.over_time_hours ?? entry.overtime ?? 0),
    ptoHours: safeNumber(entry.pto_hours ?? entry.pto ?? 0),
    sickHours: safeNumber(entry.sick_hours ?? entry.sick ?? 0),
    vacationHours: safeNumber(entry.vacation_hours ?? entry.vacation ?? 0),
    accruals: {
      pto: resolveAccrual(accruals?.pto ?? entry.pto_accrued ?? null),
      sick: resolveAccrual(accruals?.sick ?? entry.sick_accrued ?? null),
      vacation: resolveAccrual(accruals?.vacation ?? entry.vacation_accrued ?? null),
    },
  };
}

function normalizeFromUser(user: RawUserFallback, index: number): UserHourSummary {
  const name = (user.name || "").trim();
  const email = (user.email || "").trim();
  const fallbackName = name || (email ? (email.includes("@") ? email.split("@")[0] : email) : "Unknown");
  return {
    userId: user.id ? String(user.id) : `__user-${index}`,
    name: fallbackName,
    email: email || null,
    employeeId: user.employee_id ?? null,
    regularHours: 0,
    overtimeHours: 0,
    ptoHours: 0,
    sickHours: 0,
    vacationHours: 0,
    accruals: { pto: 0, sick: 0, vacation: 0 },
  };
}

function isNotFound(error: unknown): boolean {
  const maybe = error as { response?: { status?: number } };
  return maybe?.response?.status === 404;
}

export async function fetchUserHours(tenantId: string): Promise<UserHourSummary[]> {
  if (!tenantId) return [];

  try {
    const { data } = await api.get<RawHourEntry[]>("/hours", {
      params: { tenant_id: tenantId },
    });
    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }
    return data.map((item, index) => normalizeEntry(item ?? {}, index));
  } catch (error) {
    if (!isNotFound(error)) {
      // If backend returns empty object, still provide fallback zeros
      const maybeArray = (error as { response?: { data?: unknown } })?.response?.data;
      if (Array.isArray(maybeArray)) {
        return maybeArray.map((item, index) => normalizeEntry((item ?? {}) as RawHourEntry, index));
      }
      throw error;
    }
  }

  const { data: users } = await api.get<RawUserFallback[]>("/users", {
    params: { tenant_id: tenantId },
  });
  if (!Array.isArray(users) || users.length === 0) return [];
  return users.map((user, index) => normalizeFromUser(user ?? {}, index));
}

export async function saveAccruals(
  tenantId: string,
  userId: string,
  payload: { pto?: number; sick?: number; vacation?: number }
): Promise<UserHourSummary> {
  const body = {
    accruals: {
      pto: safeNumber(payload.pto ?? 0),
      sick: safeNumber(payload.sick ?? 0),
      vacation: safeNumber(payload.vacation ?? 0),
    },
  };

  const { data } = await api.patch<RawHourEntry>(`/hours/${userId}`, body, {
    params: { tenant_id: tenantId },
  });
  return normalizeEntry(data ?? {}, 0);
}
