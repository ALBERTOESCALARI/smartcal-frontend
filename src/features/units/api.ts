import { api } from "@/lib/api";

export type Unit = {
  id: string;
  tenant_id: string;
  name: string;
};

export async function fetchUnits(tenantId: string) {
  const { data } = await api.get<Unit[]>("/units", {
    params: tenantId ? { tenant_id: tenantId } : undefined,
  });
  return data;
}

export async function createUnit(tenantId: string, payload: { name: string }) {
  const name = (payload?.name ?? "").trim();
  if (!name) {
    throw new Error("Unit name is required");
  }

  try {
    const { data } = await api.post<Unit>(
      "/units",
      { name, tenant_id: tenantId }, // include tenant in body too for stricter backends
      {
        params: tenantId ? { tenant_id: tenantId } : undefined,
      }
    );
    return data;
  } catch (err: any) {
    const status = err?.response?.status;
    const detail = err?.response?.data?.detail;
    if (status === 422 && detail) {
      // Surface FastAPI validation messages for easier debugging
      const msg = Array.isArray(detail)
        ? detail.map((d: any) => `${d?.loc?.join(".")}: ${d?.msg}`).join("; ")
        : typeof detail === "string"
        ? detail
        : JSON.stringify(detail);
      throw new Error(`Validation failed (422): ${msg}`);
    }
    throw err;
  }
}
export async function deleteUnit(id: string) {
  const tenantId =
    typeof window !== "undefined" ? localStorage.getItem("tenant_id") : undefined;
  const baseParams = tenantId ? { tenant_id: tenantId } : undefined;

  // 1) Preferred: DELETE /units/{id}
  try {
    await api.delete(`/units/${id}`, { params: baseParams });
    return id;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status !== 405 && status !== 404) throw err;
  }

  // 2) Fallback: POST /units/{id}/delete
  try {
    await api.post(`/units/${id}/delete`, null, { params: baseParams });
    return id;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status !== 405 && status !== 404) throw err;
  }

  // 3) Fallback: DELETE /units?id={id}
  await api.delete(`/units`, { params: { ...(baseParams || {}), id } });
  return id;
}