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

export async function fetchAvailability(
  tenantId: string,
  params: { start?: string; end?: string; status?: AvailabilityStatus } = {}
): Promise<Availability[]> {
  const { data } = await api.get<Availability[]>("/availability", {
    params: {
      tenant_id: tenantId,
      ...(params.start ? { start: params.start } : {}),
      ...(params.end ? { end: params.end } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    headers: { "X-Tenant-ID": tenantId },
  });
  return data;
}

export async function fetchMyAvailability(tenantId?: string): Promise<Availability[]> {
  const { data } = await api.get<Availability[]>("/availability/mine", {
    params: tenantId ? { tenant_id: tenantId } : undefined,
    headers: tenantId ? { "X-Tenant-ID": tenantId } : undefined,
  });
  return data;
}

export async function createAvailability(
  tenantId: string,
  payload: AvailabilityCreateInput
): Promise<Availability> {
  const { data } = await api.post<Availability>(
    "/availability",
    {
      start_ts: payload.start_ts,
      end_ts: payload.end_ts,
      notes: payload.notes ?? null,
    },
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
    }
  );
  return data;
}

export async function updateAvailability(
  tenantId: string,
  availabilityId: string,
  payload: Partial<AvailabilityCreateInput>
): Promise<Availability> {
  const { data } = await api.patch<Availability>(
    `/availability/${availabilityId}`,
    payload,
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
    }
  );
  return data;
}

export async function approveAvailability(
  tenantId: string,
  availabilityId: string
): Promise<Availability> {
  const { data } = await api.post<Availability>(
    `/availability/${availabilityId}/approve`,
    null,
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
    }
  );
  return data;
}

export async function denyAvailability(
  tenantId: string,
  availabilityId: string
): Promise<Availability> {
  const { data } = await api.post<Availability>(
    `/availability/${availabilityId}/deny`,
    null,
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
    }
  );
  return data;
}

export async function cancelAvailability(
  tenantId: string,
  availabilityId: string
): Promise<Availability> {
  const { data } = await api.post<Availability>(
    `/availability/${availabilityId}/cancel`,
    null,
    {
      params: { tenant_id: tenantId },
      headers: { "X-Tenant-ID": tenantId },
    }
  );
  return data;
}
