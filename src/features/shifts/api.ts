// src/features/shifts/api.ts
import { api } from "@/lib/api";
// src/features/shifts/api.ts

export type Shift = {
  id: string;
  tenant_id: string;
  unit_id: string | null;
  user_id: string | null;
  start_time: string; // ISO
  end_time: string;   // ISO
  notes?: string | null;
  status?: string | null;
  color?: string | null; // UI color code for styling
};

export async function fetchShifts(
  tenantId: string,
  filter?: { unit_id?: string; user_id?: string }
) {
  const params: Record<string, string> = { tenant_id: tenantId };
  if (filter?.unit_id) params.unit_id = filter.unit_id;
  if (filter?.user_id) params.user_id = filter.user_id;
  const { data } = await api.get<Shift[]>("/shifts", { params });
  return data;
}

export async function createShift(
  tenantId: string,
  payload: {
    unit_id: string;
    user_id?: string | null;
    start_time: string; // ISO
    end_time: string;   // ISO
    notes?: string | null;
  }
) {
  const { data } = await api.post<Shift>("/shifts", payload, {
    params: { tenant_id: tenantId },
  });
  return data;
}

export async function deleteShift(tenantId: string, id: string) {
  await api.delete(`/shifts/${id}`, { params: { tenant_id: tenantId } });
  return id;
}

// Get a single shift by id
export async function getShift(tenantId: string, id: string) {
  const { data } = await api.get<Shift>(`/shifts/${id}`, {
    params: { tenant_id: tenantId },
  });
  return data;
}

// Update an existing shift (partial update). Sends tenant_id as query param.
export async function updateShift(
  tenantId: string,
  id: string,
  payload: {
    unit_id?: string | null;
    user_id?: string | null;
    start_time?: string; // ISO 8601
    end_time?: string;   // ISO 8601
    status?: string | null;
    notes?: string | null;
  }
) {
  const { data } = await api.patch<Shift>(`/shifts/${id}`, payload, {
    params: { tenant_id: tenantId },
  });
  return data;
}