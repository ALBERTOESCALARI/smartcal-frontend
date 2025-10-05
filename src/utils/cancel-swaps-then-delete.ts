import { cancelSwapRequest, fetchSwapRequests } from "@/features/requests/swaps/api";
import { api } from "@/lib/api";

/**
 * Cancels pending/approved swaps for a shift, then deletes the shift.
 */
export async function cancelSwapsThenDeleteShift(
  tenantId: string,
  shiftId: string
): Promise<{ cancelled: number; deleted: true }> {
  const swaps = await fetchSwapRequests(tenantId);

  // Filter swaps that belong to this shift
  const blocking = swaps.filter(
    (s) => s.shiftId === shiftId && (s.status === "pending" || s.status === "approved")
  );

  // Cancel them first
  for (const s of blocking) {
    await cancelSwapRequest(tenantId, s.id, "Shift deleted");
  }

  // Then delete the shift
  await api.delete(`/shifts/${shiftId}`, { params: { tenant_id: tenantId } });

  return { cancelled: blocking.length, deleted: true };
}