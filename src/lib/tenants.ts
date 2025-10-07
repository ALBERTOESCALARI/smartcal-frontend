export function getTenantId(): string | null {
  try { return localStorage.getItem("tenant_id"); } catch { return null; }
}

export function setTenantIdOnce(id: string) {
  if (!id) return;
  try {
    const existing = localStorage.getItem("tenant_id");
    if (!existing) localStorage.setItem("tenant_id", id); // lock in once
  } catch {}
}

export function forceSetTenantId(id: string) { // optional admin override
  if (!id) return;
  try { localStorage.setItem("tenant_id", id); } catch {}
}

// --- Server Hourly Rate API helpers ---

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

function getAuthToken(): string | undefined {
  try {
    // Adjust this key if your app stores the token under a different name
    const t = localStorage.getItem("access_token");
    return t || undefined;
  } catch {
    return undefined;
  }
}

function authHeaders(extra?: Record<string, string>) {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra ?? {}),
  };
}

export async function fetchTenantRate(
  tenantId: string
): Promise<{ tenant_id: string; hourly_rate: string | null }> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE is not set");
  const res = await fetch(`${API_BASE}/tenants/${tenantId}/rate`, {
    headers: authHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Load rate failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}

export async function updateTenantRate(
  tenantId: string,
  hourlyRate: string | null
): Promise<{ tenant_id: string; hourly_rate: string | null }> {
  if (!API_BASE) throw new Error("NEXT_PUBLIC_API_BASE is not set");
  const res = await fetch(`${API_BASE}/tenants/${tenantId}/rate`, {
    method: "PUT",
    headers: authHeaders(),
    credentials: "include",
    body: JSON.stringify({ hourly_rate: hourlyRate }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Update rate failed (${res.status}): ${text || res.statusText}`);
  }
  return res.json();
}