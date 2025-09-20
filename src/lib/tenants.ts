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