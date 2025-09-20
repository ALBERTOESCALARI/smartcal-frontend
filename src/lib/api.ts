import axios from "axios";
// Lightweight forbidden notice without external deps
function notifyForbidden(message: string) {
  try {
    // If a global toast function exists (from your UI), use it
    const anyWin = window as any;
    if (anyWin?.toast && typeof anyWin.toast === "function") {
      anyWin.toast({ title: "Insufficient permissions", description: message, variant: "destructive" });
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
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000",
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // ✅ Always send tenant_id as query param if saved, with act_as_tenant_id override
    const actAsTenantId = sessionStorage.getItem("act_as_tenant_id");
    const tenantId = actAsTenantId || localStorage.getItem("tenant_id");
    if (tenantId) {
      config.params = { ...(config.params || {}), tenant_id: tenantId };
    }
  }
  return config;
});

// --- Auto-logout on invalid credentials / expired token ---
if (
  typeof window !== "undefined" &&
  !(window as any).__smartcal_auth_interceptor_added
) {
  (window as any).__smartcal_auth_interceptor_added = true;

  api.interceptors.response.use(
    (res) => res,
    (error) => {
      const status = error?.response?.status;
      const data = error?.response?.data;
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
        notifyForbidden("You don’t have access to that resource.");
      }

      return Promise.reject(error);
    }
  );
}