import { api } from "@/lib/api";

export type AvailabilityStatus = "proposed" | "approved" | "denied" | "cancelled";

export type Availability = {
  id: string;
  tenant_id: string;
  user_id: string;
  start_ts: string;
  end_ts: string;
  status: AvailabilityStatus;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type AvailabilityCreateInput = {
  start_ts: string;
  end_ts: string;
  notes?: string | null;
};

function isAxiosErr(err: any): err is { response?: { status?: number; data?: any } } {
  return !!err && typeof err === "object" && "response" in err;
}

// If backend returns 204 or empty body, return a minimal safe object to avoid UI crashes.
function coerceAvailability(data: any, fallback?: Partial<Availability>): Availability {
  if (data && typeof data === "object" && data.id) return data as Availability;
  const nowIso = new Date().toISOString();
  return {
    id: (fallback?.id as string) || "",
    tenant_id: (fallback?.tenant_id as string) || "",
    user_id: (fallback?.user_id as string) || "",
    start_ts: (fallback?.start_ts as string) || nowIso,
    end_ts: (fallback?.end_ts as string) || nowIso,
    status: (fallback?.status as AvailabilityStatus) || "proposed",
    notes: fallback?.notes ?? null,
    created_at: (fallback?.created_at as string) || nowIso,
    updated_at: (fallback?.updated_at as string) || nowIso,
  };
}

export async function fetchAvailability(
  tenantId: string,
  params: { start?: string; end?: string; status?: AvailabilityStatus } = {}
): Promise<Availability[]> {
  try {
    const { data } = await api.get<Availability[]>("/availability", {
      params: {
        tenant_id: tenantId,
        ...(params.start ? { start: params.start } : {}),
        ...(params.end ? { end: params.end } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      headers: { "X-Tenant-ID": tenantId },
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (isAxiosErr(err)) {
      const code = err.response?.status ?? 0;
      if (code === 401 || code === 403 || code === 404) return [];
    }
    // Unknown error: rethrow so error boundary / toast can handle
    throw err;
  }
}

export async function fetchMyAvailability(tenantId?: string): Promise<Availability[]> {
  try {
    const { data } = await api.get<Availability[]>("/availability/mine", {
      params: tenantId ? { tenant_id: tenantId } : undefined,
      headers: tenantId ? { "X-Tenant-ID": tenantId } : undefined,
    });
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (isAxiosErr(err)) {
      const code = err.response?.status ?? 0;
      if (code === 401 || code === 403 || code === 404) return [];
    }
    throw err;
  }
}

export async function createAvailability(
  tenantId: string,
  payload: AvailabilityCreateInput
): Promise<Availability> {
  const res = await api.post<Availability>(
    "/availability",
    {
      start_ts: payload.start_ts,
      end_ts: payload.end_ts,
      notes: payload.notes ?? null,
    },
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
      validateStatus: () => true,
    }
  );
  if (res.status === 204) return coerceAvailability(res.data, { tenant_id: tenantId });
  if (res.status >= 200 && res.status < 300) return coerceAvailability(res.data);
  throw new Error(`createAvailability failed (${res.status})`);
}

export async function updateAvailability(
  tenantId: string,
  availabilityId: string,
  payload: Partial<AvailabilityCreateInput>
): Promise<Availability> {
  const res = await api.patch<Availability>(
    `/availability/${availabilityId}`,
    payload,
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
      validateStatus: () => true,
    }
  );
  if (res.status === 204) return coerceAvailability(res.data, { id: availabilityId, tenant_id: tenantId });
  if (res.status >= 200 && res.status < 300) return coerceAvailability(res.data);
  throw new Error(`updateAvailability failed (${res.status})`);
}

export async function approveAvailability(
  tenantId: string,
  availabilityId: string
): Promise<Availability> {
  const res = await api.post<Availability>(
    `/availability/${availabilityId}/approve`,
    null,
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
      validateStatus: () => true,
    }
  );
  if (res.status === 204) return coerceAvailability(res.data, { id: availabilityId, tenant_id: tenantId, status: "approved" });
  if (res.status >= 200 && res.status < 300) return coerceAvailability(res.data);
  throw new Error(`approveAvailability failed (${res.status})`);
}

export async function denyAvailability(
  tenantId: string,
  availabilityId: string
): Promise<Availability> {
  const res = await api.post<Availability>(
    `/availability/${availabilityId}/deny`,
    null,
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
      validateStatus: () => true,
    }
  );
  if (res.status === 204) return coerceAvailability(res.data, { id: availabilityId, tenant_id: tenantId, status: "denied" });
  if (res.status >= 200 && res.status < 300) return coerceAvailability(res.data);
  throw new Error(`denyAvailability failed (${res.status})`);
}

export async function cancelAvailability(
  tenantId: string,
  availabilityId: string
): Promise<Availability> {
  const res = await api.post<Availability>(
    `/availability/${availabilityId}/cancel`,
    null,
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
      validateStatus: () => true,
    }
  );
  if (res.status === 204) return coerceAvailability(res.data, { id: availabilityId, tenant_id: tenantId, status: "cancelled" });
  if (res.status >= 200 && res.status < 300) return coerceAvailability(res.data);
  throw new Error(`cancelAvailability failed (${res.status})`);
}