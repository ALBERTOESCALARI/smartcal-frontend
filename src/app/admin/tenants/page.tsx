"use client";
import RequireSuperadmin from "@/components/require-superadmin";
import { api } from "@/lib/api";
import { useEffect, useState } from "react";

type Tenant = { id: string; name: string; slug?: string };

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/tenants"); // superadmin endpoint
      setTenants(data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.post("/tenants", { name, slug: slug || undefined }); // superadmin-only on backend
      setName(""); setSlug("");
      await load();
    } finally {
      setLoading(false);
    }
  };

  return (
    <RequireSuperadmin>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <h1 className="text-xl font-semibold">Tenants</h1>

        <form onSubmit={create} className="flex flex-col gap-3 border rounded-lg p-4 bg-muted/30">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="mb-1">Name</div>
              <input className="w-full border rounded px-3 py-2" value={name} onChange={e=>setName(e.target.value)} required/>
            </label>
            <label className="text-sm">
              <div className="mb-1">Slug (optional)</div>
              <input className="w-full border rounded px-3 py-2" value={slug} onChange={e=>setSlug(e.target.value)} placeholder="acme-ems"/>
            </label>
          </div>
          <div className="flex gap-2">
            <button className="border rounded px-3 py-2" disabled={loading}>{loading ? "Saving…" : "Create tenant"}</button>
          </div>
        </form>

        <div className="border rounded-lg">
          <div className="px-4 py-2 border-b font-medium">All tenants</div>
          <ul className="divide-y">
            {tenants.map(t => (
              <li key={t.id} className="px-4 py-3 flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-sm text-muted-foreground">ID: {t.id}{t.slug ? ` • ${t.slug}` : ""}</div>
                </div>
                {/* Optional: “Act as” button */}
                <button
                  className="border rounded px-3 py-1.5 text-sm"
                  onClick={() => {
                    // don't make this permanent; this is superadmin session-only
                    try { sessionStorage.setItem("act_as_tenant_id", t.id); } catch {}
                    // navigate to a tenant-scoped page
                    window.location.href = "/dashboard";
                  }}
                >
                  Act as tenant
                </button>
              </li>
            ))}
            {tenants.length === 0 && !loading && (
              <li className="px-4 py-6 text-sm text-muted-foreground">No tenants yet.</li>
            )}
          </ul>
        </div>
      </div>
    </RequireSuperadmin>
  );
}