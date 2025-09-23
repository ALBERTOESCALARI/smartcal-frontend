import axios, { type AxiosError } from "axios";

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
});

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
        config.params = { ...(config.params || {}), tenant_id: tenantId };
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
