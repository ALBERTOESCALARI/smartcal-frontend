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

export async function fetchTenantRate(
  tenantId: string,
  authToken?: string
): Promise<{ tenant_id: string; hourly_rate: string | null }> {
  const res = await fetch(`/tenants/${tenantId}/rate`, {
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load tenant rate (${res.status})`);
  return res.json();
}

export async function updateTenantRate(
  tenantId: string,
  hourlyRate: string | null, // pass like "18.00" or null
  authToken?: string
): Promise<{ tenant_id: string; hourly_rate: string | null }> {
  const res = await fetch(`/tenants/${tenantId}/rate`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify({ hourly_rate: hourlyRate }),
  });
  if (!res.ok) throw new Error(`Failed to update tenant rate (${res.status})`);
  return res.json();
}