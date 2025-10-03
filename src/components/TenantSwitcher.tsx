// src/components/TenantSwitcher.tsx
import { api, getActiveTenantId, setActiveTenantId } from "@/lib/api";
import React, { useEffect, useState } from "react";

type Tenant = { id: string; name?: string | null };

export default function TenantSwitcher() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [active, setActive] = useState(getActiveTenantId() || "");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Interceptor will attach Authorization + X-Tenant-ID automatically.
        // If your backend returns only the caller's tenant, this will be length 1 for normal admins.
        const res = await api.get<Tenant[]>("/tenants", { params: { limit: 50 } });
        if (!mounted) return;
        setTenants(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (!mounted) return;
        setTenants([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const tid = e.target.value;
    setActive(tid);
    setActiveTenantId(tid);   // persisted to localStorage (your api.ts handles this)
    window.location.reload(); // simplest way to refresh stores/queries
  }

  if (loading || tenants.length <= 1) return null; // hide when only one tenant

  return (
    <select
      value={active}
      onChange={onChange}
      className="border rounded px-2 py-1 text-sm font-mono"
      title="Switch tenant"
    >
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name || t.id}
        </option>
      ))}
    </select>
  );
}