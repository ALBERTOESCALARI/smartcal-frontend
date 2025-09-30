import axios, { type AxiosError } from "axios";
import type { BrowserLocationReading } from "./location";

export type UUID = string;

export interface LocationPayload {
  lat?: number | null;
  lng?: number | null;
  map_url?: string | null;
}

export interface TimeEntryOut {
  id: UUID;
  tenant_id: UUID;
  user_id: UUID;
  shift_id?: UUID | null;
  clock_in: string;
  clock_out?: string | null;
  location?: string | LocationPayload | null;
  latitude?: number | null;
  longitude?: number | null;
  map_url?: string | null;
  created_at: string;
  updated_at: string;
  earnings?: number | null;
}

export interface ClockStatus {
  status: "clocked_in" | "clocked_out";
  open_entry?: TimeEntryOut | null;
}

type LocationInput = LocationPayload | BrowserLocationReading | string | null | undefined;

type NormalizedLocationPayload = {
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  map_url?: string | null;
  accuracy?: number | null;
};

function formatLatLng(lat: number | null | undefined, lng: number | null | undefined) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function normalizeLocationPayload(input: LocationInput): NormalizedLocationPayload | null {
  if (!input) return null;

  if (typeof input === "string") {
    return { location: input };
  }

  if (typeof input === "object" && "formatted" in input) {
    const reading = input as BrowserLocationReading;
    const lat = Number.isFinite(reading.latitude) ? reading.latitude : null;
    const lng = Number.isFinite(reading.longitude) ? reading.longitude : null;
    const accuracy = Number.isFinite(reading.accuracy ?? NaN) ? reading.accuracy ?? null : null;
    const location = reading.formatted || formatLatLng(lat, lng);
    return { location: location ?? null, latitude: lat, longitude: lng, accuracy };
  }

  const payload = input as LocationPayload & {
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number | null;
    mapUrl?: string | null;
    location_accuracy?: number | null;
    location_latitude?: number | null;
    location_longitude?: number | null;
  };

  const rawLat =
    payload.lat ??
    payload.latitude ??
    payload.location_latitude ??
    (typeof (payload as any).lat === "string" ? Number.parseFloat((payload as any).lat) : undefined);
  const coercedLat = typeof rawLat === "number" && Number.isFinite(rawLat) ? rawLat : null;
  const rawLng =
    payload.lng ??
    payload.longitude ??
    payload.location_longitude ??
    (typeof (payload as any).lng === "string" ? Number.parseFloat((payload as any).lng) : undefined);
  const coercedLng = typeof rawLng === "number" && Number.isFinite(rawLng) ? rawLng : null;
  const location =
    typeof payload.location === "string"
      ? payload.location
      : formatLatLng(coercedLat, coercedLng);
  const mapUrlRaw = payload.map_url ?? payload.mapUrl ?? null;
  const mapUrl = typeof mapUrlRaw === "string" && mapUrlRaw ? mapUrlRaw : null;
  const accuracyRaw =
    payload.accuracy ?? payload.location_accuracy ?? (payload as any).accuracy ?? null;
  const accuracy = typeof accuracyRaw === "number" && Number.isFinite(accuracyRaw) ? accuracyRaw : null;

  if (!location && coercedLat == null && coercedLng == null && !mapUrl) return null;

  return {
    location: location ?? null,
    latitude: coercedLat,
    longitude: coercedLng,
    map_url: mapUrl,
    accuracy,
  };
}

function authHeaders(token?: string | null, tenantId?: string | null) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (tenantId) headers["X-Tenant-ID"] = tenantId;
  return headers;
}

function getApiBase(): string {
  const envBase =
    process.env.NEXT_PUBLIC_API_BASE ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "";
  const base = (envBase || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE (or *_BASE_URL / *_API_URL) is not set."
    );
  }
  return base;
}

// Lightweight forbidden notice without external deps
type SmartCalToastPayload = {
  title?: string;
  description?: string;
  variant?: string;
};

type SmartCalWindow = Window & {
  toast?: (payload: SmartCalToastPayload) => void;
  __smartcal_auth_interceptor_added?: boolean;
};

function getSmartCalWindow(): SmartCalWindow | null {
  return typeof window !== "undefined" ? (window as SmartCalWindow) : null;
}

function notifyForbidden(message: string) {
  try {
    // If a global toast function exists (from your UI), use it
    const smartWindow = getSmartCalWindow();
    if (smartWindow?.toast && typeof smartWindow.toast === "function") {
      smartWindow.toast({ title: "Insufficient permissions", description: message, variant: "destructive" });
      return;
    }
  } catch {}
  // Fallback
  if (typeof window !== "undefined") {
    try { console.warn("Forbidden:", message); } catch {}
    try { alert(`Insufficient permissions: ${message}`); } catch {}
  }
}

export const api = axios.create({
  baseURL: getApiBase(),
  timeout: 15000,
  headers: { Accept: "application/json" },
});

export const apiClient = api;

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // ✅ Always send tenant_id as query param if saved, with act_as_tenant_id override
    // ...but skip auth routes to avoid confusing the backend
    const urlStr = String(config.url || "");
    const isAuthRoute = urlStr.startsWith("/auth") || urlStr.includes("/auth/");
    if (!isAuthRoute) {
      const actAsTenantId = sessionStorage.getItem("act_as_tenant_id");
      const tenantId = actAsTenantId || localStorage.getItem("tenant_id");
      if (tenantId) {
        // send both query param (for convenience) and header (for backend auth)
        config.params = { ...(config.params || {}), tenant_id: tenantId };
        config.headers = {
          ...(config.headers || {}),
          "X-Tenant-ID": tenantId,
        } as any;
      }
    }
  }
  return config;
});

// --- Auto-logout on invalid credentials / expired token ---
const smartWindow = getSmartCalWindow();

if (smartWindow && !smartWindow.__smartcal_auth_interceptor_added) {
  smartWindow.__smartcal_auth_interceptor_added = true;

  api.interceptors.response.use(
    (res) => res,
    (error: AxiosError<{ detail?: string } | string>) => {
      const status = error.response?.status;
      const data = error.response?.data;
      const detail = (typeof data === "string" ? data : data?.detail) || "";

      const isAuthExpired =
        status === 401 ||
        /could not validate credentials/i.test(String(detail));

      if (isAuthExpired) {
        try {
          // Clear only session auth; KEEP tenant_id
          localStorage.removeItem("token");
          sessionStorage.clear();
        } catch {}

        // Notify app to reset UI/cache ASAP
        try {
          window.dispatchEvent(new Event("auth:logout"));
        } catch {}

        // Redirect to login with reason
        try {
          const url = new URL("/login", window.location.origin);
          url.searchParams.set("reason", "expired");
          window.location.replace(url.toString());
        } catch {
          window.location.href = "/login?reason=expired";
        }

        return Promise.reject(error);
      }

      if (status === 403) {
        const msg =
          (typeof data === "string" ? data : data?.detail) ||
          "You don’t have access to that resource.";
        notifyForbidden(msg);
      }

      return Promise.reject(error);
    }
  );
}

// ===================== Auth storage helpers =====================
const TOKEN_KEY = "token";
const TENANT_KEY = "tenant_id"; // keep compatibility with existing code
const SESSION_USER_KEY = "session_user";

export function saveToken(token: string) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}
export function loadToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

export function setActiveTenantId(tenantId: string) {
  try { localStorage.setItem(TENANT_KEY, tenantId); } catch {}
}
export function getActiveTenantId(): string | null {
  try { return localStorage.getItem(TENANT_KEY); } catch { return null; }
}
export function clearActiveTenantId() {
  try { localStorage.removeItem(TENANT_KEY); } catch {}
}

export type SessionUser = { id: string; email: string; role?: string };
function saveSessionUser(u: SessionUser) {
  try { localStorage.setItem(SESSION_USER_KEY, JSON.stringify(u)); } catch {}
}
export function loadSessionUser(): SessionUser | null {
  try { const raw = localStorage.getItem(SESSION_USER_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function clearSessionUser() {
  try { localStorage.removeItem(SESSION_USER_KEY); } catch {}
}

// ===================== Core auth calls =====================
type TokenResponse = { access_token?: string; token_type?: string; detail?: string };

export async function getToken(email: string, password: string): Promise<string> {
  const form = new URLSearchParams();
  form.append("username", email);
  form.append("password", password);

  const res = await axios.post<TokenResponse>(`${getApiBase()}/auth/token`, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    validateStatus: () => true,
  });

  if (!res.status || res.status < 200 || res.status >= 300 || !res.data?.access_token) {
    const msg = res.data?.detail || `Login failed (${res.status})`;
    throw new Error(msg);
  }
  return res.data.access_token!;
}

function normalizeSessionUser(data: any): SessionUser | null {
  if (!data) return null;
  if (data.user?.id && data.user?.email) return { id: data.user.id, email: data.user.email, role: data.user.role };
  if (data.id && data.email) return { id: data.id, email: data.email, role: data.role };
  return null;
}

export async function getMe(token: string, tenantId?: string | null): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (tenantId) headers["X-Tenant-ID"] = tenantId; // header for backend; query param added by interceptor

  const res = await axios.get(`${getApiBase()}/auth/me`, { headers, validateStatus: () => true });
  if (!res.status || res.status < 200 || res.status >= 300) {
    let msg = `Auth check failed (${res.status})`;
    try { if (res.data?.detail) msg += ` – ${res.data.detail}`; } catch {}
    throw new Error(msg);
  }
  return res.data;
}

export async function loginAndFetchMe(email: string, password: string, tenantId?: string | null) {
  const token = await getToken(email, password);
  saveToken(token);
  const me = await getMe(token, tenantId ?? getActiveTenantId());
  const user = normalizeSessionUser(me) || (email ? { id: me?.id ?? me?.user?.id, email } as SessionUser : null);
  if (user) saveSessionUser(user);
  if (tenantId) setActiveTenantId(tenantId);
  return { token, me, user };
}

export function logout() {
  clearToken();
  clearSessionUser();
}

export function isAuthed(): boolean {
  if (typeof window === "undefined") return false;
  return !!loadToken();
}

// ===================== Time entries API =====================
type AuthOverrides = { token?: string | null; tenantId?: string | null };

export async function getClockStatus(overrides?: AuthOverrides): Promise<ClockStatus> {
  const { config } = buildAuthConfig(overrides);
  const res = await api.get("/time/clock", config);
  return res.data as ClockStatus;
}

function resolveTenantId(): string | null {
  if (typeof window === "undefined") return getActiveTenantId();
  try {
    const actAs = sessionStorage.getItem("act_as_tenant_id");
    if (actAs) return actAs;
  } catch {}
  return getActiveTenantId();
}

function buildAuthConfig(overrides?: AuthOverrides) {
  const token = overrides?.token ?? loadToken();
  const tenantId = overrides?.tenantId ?? resolveTenantId();
  const headers = authHeaders(token, tenantId);
  const config: { headers?: Record<string, string>; params?: Record<string, string | number> } = {};
  if (Object.keys(headers).length) config.headers = headers;
  if (tenantId) config.params = { tenant_id: tenantId };
  return { token: token ?? null, tenantId: tenantId ?? null, config };
}

type ClockInOptions = AuthOverrides & {
  shiftId?: UUID | null;
  location?: LocationInput;
  whenISO?: string | null;
};

function isClockInOptions(value: unknown): value is ClockInOptions {
  if (!value || typeof value !== "object") return false;
  const probe = value as Record<string, unknown>;
  return (
    "token" in probe ||
    "tenantId" in probe ||
    "shiftId" in probe ||
    "location" in probe ||
    "whenISO" in probe
  );
}

function normalizeClockInArgs(
  arg1?: string | null | ClockInOptions,
  arg2?: BrowserLocationReading | string
): ClockInOptions {
  if (isClockInOptions(arg1)) return arg1;
  return { shiftId: (arg1 as string | null | undefined) ?? null, location: arg2 };
}

export async function clockIn(options?: ClockInOptions): Promise<TimeEntryOut>;
export async function clockIn(
  shiftId?: string | null,
  location?: BrowserLocationReading | string
): Promise<TimeEntryOut>;
export async function clockIn(
  arg1?: string | null | ClockInOptions,
  arg2?: BrowserLocationReading | string
): Promise<TimeEntryOut> {
  const opts = normalizeClockInArgs(arg1, arg2);
  const { tenantId, config } = buildAuthConfig(opts);
  if (!tenantId) {
    throw new Error("Cannot clock in without an active tenant.");
  }

  const locationPayload = normalizeLocationPayload(opts.location);
  const body: Record<string, unknown> = {
    tenant_id: tenantId,
  };
  if (typeof opts.shiftId === "string" && opts.shiftId) {
    body.shift_id = opts.shiftId;
  }
  if (locationPayload) {
    body.location = locationPayload.location ?? null;
    if (typeof locationPayload.latitude === "number") {
      body.latitude = locationPayload.latitude;
      body.location_latitude = locationPayload.latitude;
    }
    if (typeof locationPayload.longitude === "number") {
      body.longitude = locationPayload.longitude;
      body.location_longitude = locationPayload.longitude;
    }
    if (typeof locationPayload.accuracy === "number") {
      body.location_accuracy = locationPayload.accuracy;
    }
    if (locationPayload.map_url) {
      body.map_url = locationPayload.map_url;
    }
  }
  if (opts.whenISO) body.clock_in = opts.whenISO;

  const res = await api.post("/time/clock-in", body, config);
  return res.data as TimeEntryOut;
}

type ClockOutOptions = AuthOverrides & {
  location?: LocationInput;
  earnings?: number | null;
  whenISO?: string | null;
};

function isClockOutOptions(value: unknown): value is ClockOutOptions {
  if (!value || typeof value !== "object") return false;
  const probe = value as Record<string, unknown>;
  return (
    "token" in probe ||
    "tenantId" in probe ||
    "location" in probe ||
    "earnings" in probe ||
    "whenISO" in probe
  );
}

function normalizeClockOutArgs(
  arg1?: number | ClockOutOptions | null,
  arg2?: BrowserLocationReading | string
): ClockOutOptions {
  if (isClockOutOptions(arg1)) return arg1;
  return { earnings: (typeof arg1 === "number" ? arg1 : undefined) ?? null, location: arg2 };
}

export async function clockOut(options?: ClockOutOptions): Promise<TimeEntryOut>;
export async function clockOut(
  earnings?: number,
  location?: BrowserLocationReading | string
): Promise<TimeEntryOut>;
export async function clockOut(
  arg1?: number | ClockOutOptions | null,
  arg2?: BrowserLocationReading | string
): Promise<TimeEntryOut> {
  const opts = normalizeClockOutArgs(arg1, arg2);
  const { tenantId, config } = buildAuthConfig(opts);
  if (!tenantId) {
    throw new Error("Cannot clock out without an active tenant.");
  }

  const locationPayload = normalizeLocationPayload(opts.location);
  const body: Record<string, unknown> = {
    tenant_id: tenantId,
    earnings: opts.earnings ?? null,
  };
  if (locationPayload) {
    body.location = locationPayload.location ?? null;
    if (typeof locationPayload.latitude === "number") {
      body.latitude = locationPayload.latitude;
      body.location_latitude = locationPayload.latitude;
    }
    if (typeof locationPayload.longitude === "number") {
      body.longitude = locationPayload.longitude;
      body.location_longitude = locationPayload.longitude;
    }
    if (typeof locationPayload.accuracy === "number") {
      body.location_accuracy = locationPayload.accuracy;
    }
    if (locationPayload.map_url) {
      body.map_url = locationPayload.map_url;
    }
  }
  if (opts.whenISO) body.clock_out = opts.whenISO;

  const res = await api.patch("/time/clock-out", body, config);
  return res.data as TimeEntryOut;
}

type TimeEntriesFilters = {
  startISO?: string;
  endISO?: string;
  limit?: number;
};

type MyTimeEntriesOptions = TimeEntriesFilters & AuthOverrides;

function isMyTimeEntriesOptions(value: unknown): value is MyTimeEntriesOptions {
  if (!value || typeof value !== "object") return false;
  const probe = value as Record<string, unknown>;
  return (
    "token" in probe ||
    "tenantId" in probe ||
    "startISO" in probe ||
    "endISO" in probe ||
    "limit" in probe
  );
}

function toQueryParams(filters: TimeEntriesFilters) {
  const params: Record<string, string | number> = {};
  if (filters.startISO) params.start = filters.startISO;
  if (filters.endISO) params.end = filters.endISO;
  if (typeof filters.limit === "number") params.limit = filters.limit;
  return params;
}

function mergeQueryParams(
  target: { params?: Record<string, string | number> },
  extra: Record<string, string | number>
) {
  if (!extra || !Object.keys(extra).length) return;
  target.params = { ...(target.params ?? {}), ...extra };
}

export async function getMyTimeEntries(
  token: string,
  tenantId: string,
  opts?: TimeEntriesFilters
): Promise<TimeEntryOut[]>;
export async function getMyTimeEntries(opts?: MyTimeEntriesOptions): Promise<TimeEntryOut[]>;
export async function getMyTimeEntries(
  arg1?: string | MyTimeEntriesOptions,
  arg2?: string,
  arg3?: TimeEntriesFilters
): Promise<TimeEntryOut[]> {
  let overrides: AuthOverrides | undefined;
  let filters: TimeEntriesFilters = {};

  if (typeof arg1 === "string" && typeof arg2 === "string") {
    overrides = { token: arg1, tenantId: arg2 };
    filters = arg3 ?? {};
  } else if (isMyTimeEntriesOptions(arg1)) {
    overrides = { token: arg1.token, tenantId: arg1.tenantId };
    filters = {
      startISO: arg1.startISO,
      endISO: arg1.endISO,
      limit: arg1.limit,
    };
  }

  const { config } = buildAuthConfig(overrides);
  mergeQueryParams(config, toQueryParams(filters));

  const res = await api.get("/time/me", config);
  return res.data as TimeEntryOut[];
}

type TenantTimeEntriesFilters = TimeEntriesFilters & { userId?: UUID };
type TenantTimeEntriesOptions = TenantTimeEntriesFilters & AuthOverrides;

function isTenantTimeEntriesOptions(value: unknown): value is TenantTimeEntriesOptions {
  if (!value || typeof value !== "object") return false;
  const probe = value as Record<string, unknown>;
  return (
    "userId" in probe ||
    "token" in probe ||
    "tenantId" in probe ||
    "startISO" in probe ||
    "endISO" in probe ||
    "limit" in probe
  );
}

export async function listTenantTimeEntries(
  token: string,
  tenantId: string,
  opts?: TenantTimeEntriesFilters
): Promise<TimeEntryOut[]>;
export async function listTenantTimeEntries(
  opts?: TenantTimeEntriesOptions
): Promise<TimeEntryOut[]>;
export async function listTenantTimeEntries(
  arg1?: string | TenantTimeEntriesOptions,
  arg2?: string,
  arg3?: TenantTimeEntriesFilters
): Promise<TimeEntryOut[]> {
  let overrides: AuthOverrides | undefined;
  let filters: TenantTimeEntriesFilters = {};

  if (typeof arg1 === "string" && typeof arg2 === "string") {
    overrides = { token: arg1, tenantId: arg2 };
    filters = arg3 ?? {};
  } else if (isTenantTimeEntriesOptions(arg1)) {
    overrides = { token: arg1.token, tenantId: arg1.tenantId };
    filters = {
      startISO: arg1.startISO,
      endISO: arg1.endISO,
      limit: arg1.limit,
      userId: arg1.userId,
    };
  }

  const { config } = buildAuthConfig(overrides);
  const params = toQueryParams(filters);
  if (filters.userId) params.user_id = filters.userId;
  mergeQueryParams(config, params);

  const res = await api.get("/time/entries", config);
  return res.data as TimeEntryOut[];
}

export async function listMyTimeEntries(from?: string, to?: string) {
  return getMyTimeEntries({ startISO: from, endISO: to });
}
