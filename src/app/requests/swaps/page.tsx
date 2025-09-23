"use client";

import { useEffect, useMemo, useState } from "react";

import RequireAuth from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { fetchShifts, type Shift } from "@/features/shifts/api";
import {
  approveSwapRequest,
  cancelSwapRequest,
  createSwapRequest,
  declineSwapRequest,
  fetchSwapRequests,
  type SwapRequest,
} from "@/features/requests/swaps/api";
import { fetchUnits, type Unit } from "@/features/units/api";
import { fetchUsers, type User } from "@/features/users/api";
import { getTenantId } from "@/lib/tenants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function formatShiftLabel(shift: Shift, unitName: (id: string | null | undefined) => string) {
  const start = new Date(shift.start_time);
  const end = new Date(shift.end_time);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const dateLabel = start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const timeLabel = sameDay
    ? `${timeFmt.format(start)} – ${timeFmt.format(end)}`
    : `${timeFmt.format(start)} → ${timeFmt.format(end)}`;
  return `${unitName(shift.unit_id)} · ${dateLabel} · ${timeLabel}`;
}

function formatShiftRange(start?: string | null, end?: string | null): string {
  try {
    if (!start) return end ? new Date(end).toLocaleString() : "Scheduled shift";
    const startDate = new Date(start);
    if (!end) return startDate.toLocaleString();
    const endDate = new Date(end);
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `${formatter.format(startDate)} → ${formatter.format(endDate)}`;
  } catch {
    return start || end || "Shift";
  }
}

function formatStatus(status: SwapRequest["status"]): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
    case "cancelled":
    case "canceled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

function statusColor(status: SwapRequest["status"]): string {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-800";
    case "declined":
      return "bg-red-100 text-red-700";
    case "cancelled":
    case "canceled":
      return "bg-gray-200 text-gray-700";
    default:
      return "bg-amber-100 text-amber-700";
  }
}

type FormState = {
  shiftId: string;
  fromUserId: string;
  targetUserId: string;
  notes: string;
};

const DEFAULT_FORM: FormState = {
  shiftId: "",
  fromUserId: "",
  targetUserId: "",
  notes: "",
};

export default function SwapRequestsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});
  const [statusTarget, setStatusTarget] = useState<string | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    setTenantId(getTenantId());
  }, []);

  const usersQuery = useQuery<User[]>({
    queryKey: ["users", tenantId],
    queryFn: () => fetchUsers(tenantId ?? ""),
    enabled: Boolean(tenantId),
    staleTime: 5 * 60 * 1000,
  });

  const unitsQuery = useQuery<Unit[]>({
    queryKey: ["units", tenantId],
    queryFn: () => fetchUnits(tenantId ?? ""),
    enabled: Boolean(tenantId),
    staleTime: 5 * 60 * 1000,
  });

  const shiftsQuery = useQuery<Shift[]>({
    queryKey: ["shifts", "list", tenantId],
    queryFn: () => fetchShifts(tenantId ?? ""),
    enabled: Boolean(tenantId),
    staleTime: 60 * 1000,
  });

  const swapsQuery = useQuery<SwapRequest[]>({
    queryKey: ["requests", "swaps", tenantId],
    queryFn: () => fetchSwapRequests(tenantId ?? ""),
    enabled: Boolean(tenantId),
    staleTime: 30 * 1000,
  });

  useEffect(() => {
    if (!Array.isArray(swapsQuery.data)) return;
    setTargetDrafts((prev) => {
      const next: Record<string, string> = {};
      for (const row of swapsQuery.data) {
        next[row.id] = prev[row.id] ?? (row.targetUserId ?? "");
      }
      return next;
    });
  }, [swapsQuery.data]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Set a tenant before creating swap requests");
      if (!form.shiftId) throw new Error("Select a shift");
      if (!form.fromUserId) throw new Error("Select the requesting employee");
      return createSwapRequest(tenantId, {
        shiftId: form.shiftId,
        fromUserId: form.fromUserId,
        targetUserId: form.targetUserId || null,
        notes: form.notes?.trim() || undefined,
      });
    },
    onSuccess: (created) => {
      queryClient.setQueryData<SwapRequest[]>(["requests", "swaps", tenantId], (current) => {
        const list = Array.isArray(current) ? current.slice() : [];
        list.unshift(created);
        return list;
      });
      setForm(DEFAULT_FORM);
      toast({ title: "Swap request submitted" });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "Failed to create swap";
      toast({ title: "Unable to create swap", description: message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      targetUserId,
    }: {
      id: string;
      action: "approve" | "decline" | "cancel";
      targetUserId?: string;
    }) => {
      if (!tenantId) throw new Error("Missing tenant");
      setStatusTarget(id);
      if (action === "approve") {
        return approveSwapRequest(tenantId, id, { targetUserId: targetUserId ?? null });
      }
      if (action === "decline") {
        const note = window.prompt("Optional reason for decline:");
        return declineSwapRequest(tenantId, id, note ?? undefined);
      }
      const note = window.prompt("Optional note for cancellation:");
      return cancelSwapRequest(tenantId, id, note ?? undefined);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<SwapRequest[]>(["requests", "swaps", tenantId], (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((item) => (item.id === updated.id ? updated : item));
      });
      toast({ title: `Swap ${formatStatus(updated.status)}` });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "Swap update failed";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    },
    onSettled: () => {
      setStatusTarget(null);
    },
  });

  const users = usersQuery.data ?? [];

  const userOptions = useMemo(() => {
    return users
      .map((user) => {
        const name = (user.name || "").trim();
        const email = (user.email || "").trim();
        const label = name || (email ? (email.includes("@") ? email.split("@")[0] : email) : `User ${user.id}`);
        return { id: user.id, label, email, employee: user.employee_id ?? "" };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [users]);

  const unitName = useMemo(() => {
    const map = new Map<string, string>();
    if (Array.isArray(unitsQuery.data)) {
      for (const unit of unitsQuery.data) {
        map.set(unit.id, unit.name);
      }
    }
    return (id: string | null | undefined) => (id ? map.get(id) ?? id : "Unassigned unit");
  }, [unitsQuery.data]);

  const shiftOptions = useMemo(() => {
    if (!Array.isArray(shiftsQuery.data)) return [] as Array<{ id: string; label: string }>;
    return shiftsQuery.data.map((shift) => ({
      id: shift.id,
      label: formatShiftLabel(shift, unitName),
    }));
  }, [shiftsQuery.data, unitName]);

  const swapRows = swapsQuery.data ?? [];

  return (
    <RequireAuth>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Shift Swap Requests</h1>
            <p className="text-sm text-muted-foreground">Coordinate coverage changes and approvals.</p>
          </div>
          <Button variant="outline" onClick={() => swapsQuery.refetch()} disabled={swapsQuery.isFetching}>
            {swapsQuery.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {!tenantId ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Set an active tenant to manage shift swaps.
          </Card>
        ) : (
          <>
            <Card className="space-y-4 p-4">
              <div>
                <h2 className="text-lg font-medium">New swap request</h2>
                <p className="text-sm text-muted-foreground">Log a swap request on behalf of a team member.</p>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  createMutation.mutate();
                }}
                className="grid gap-4 md:grid-cols-2"
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Shift</span>
                  <select
                    value={form.shiftId}
                    onChange={(event) => setForm((prev) => ({ ...prev, shiftId: event.target.value }))}
                    className="h-9 rounded-md border border-input bg-background px-3"
                    required
                    disabled={shiftsQuery.isLoading || shiftsQuery.isError}
                  >
                    <option value="">Select shift…</option>
                    {shiftOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Requesting employee</span>
                  <select
                    value={form.fromUserId}
                    onChange={(event) => setForm((prev) => ({ ...prev, fromUserId: event.target.value }))}
                    className="h-9 rounded-md border border-input bg-background px-3"
                    required
                    disabled={usersQuery.isLoading || usersQuery.isError}
                  >
                    <option value="">Select user…</option>
                    {userOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.employee ? ` • ${option.employee}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Preferred coverage</span>
                  <select
                    value={form.targetUserId}
                    onChange={(event) => setForm((prev) => ({ ...prev, targetUserId: event.target.value }))}
                    className="h-9 rounded-md border border-input bg-background px-3"
                    disabled={usersQuery.isLoading || usersQuery.isError}
                  >
                    <option value="">Open to anyone</option>
                    {userOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.employee ? ` • ${option.employee}` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium">Notes</span>
                  <textarea
                    value={form.notes}
                    onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                    className="min-h-[80px] rounded-md border border-input bg-background px-3 py-2"
                    placeholder="Optional context or requirements"
                  />
                </label>

                <div className="md:col-span-2">
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Submitting…" : "Submit swap"}
                  </Button>
                </div>
              </form>
            </Card>

            {swapsQuery.isLoading ? (
              <Card className="p-4 text-sm text-muted-foreground">Loading swap requests…</Card>
            ) : swapsQuery.isError ? (
              <Card className="p-4 text-sm text-red-600">
                {(swapsQuery.error as Error)?.message || "Failed to load swap requests"}
              </Card>
            ) : swapRows.length === 0 ? (
              <Card className="p-4 text-sm text-muted-foreground">No swap requests yet.</Card>
            ) : (
              <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] border-collapse text-sm">
                    <thead className="bg-muted/60">
                      <tr className="text-left">
                        <th className="px-4 py-3 font-medium">Shift</th>
                        <th className="px-4 py-3 font-medium">Requested by</th>
                        <th className="px-4 py-3 font-medium">Preferred coverage</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Notes</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {swapRows.map((row) => {
                        const pending = statusTarget === row.id && statusMutation.isPending;
                        const targetDraft = targetDrafts[row.id] ?? "";
                        const shiftLabel = row.shiftUnit
                          ? `${row.shiftUnit} · ${formatShiftRange(row.shiftStart, row.shiftEnd)}`
                          : row.shiftStart || row.shiftEnd
                          ? formatShiftRange(row.shiftStart, row.shiftEnd)
                          : row.shiftId ?? "";
                        return (
                          <tr key={row.id} className="border-t">
                            <td className="px-4 py-3 align-top">
                              <div className="flex flex-col text-xs text-muted-foreground">
                                <span className="text-sm font-medium text-foreground">
                                  {shiftLabel || "Shift"}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="flex flex-col">
                                <span className="font-medium">{row.fromUserName}</span>
                                <span className="text-xs text-muted-foreground">
                                  {row.fromUserEmail ?? row.fromUserId}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <select
                                value={targetDraft}
                                onChange={(event) =>
                                  setTargetDrafts((prev) => ({ ...prev, [row.id]: event.target.value }))
                                }
                                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                              >
                                <option value="">{row.targetUserName ? row.targetUserName : "Open"}</option>
                                {userOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-3 align-top">
                              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusColor(row.status)}`}>
                                {formatStatus(row.status)}
                              </span>
                            </td>
                            <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                              {row.notes || "—"}
                            </td>
                            <td className="px-4 py-3 align-top">
                              <div className="flex flex-wrap gap-2">
                                {row.status === "pending" && (
                                  <>
                                    <Button
                                      size="sm"
                                      onClick={() =>
                                        statusMutation.mutate({ id: row.id, action: "approve", targetUserId: targetDraft || row.targetUserId || undefined })
                                      }
                                      disabled={pending}
                                    >
                                      {pending ? "Updating…" : "Approve"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => statusMutation.mutate({ id: row.id, action: "decline" })}
                                      disabled={pending}
                                    >
                                      Decline
                                    </Button>
                                  </>
                                )}
                                {row.status !== "cancelled" && row.status !== "canceled" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => statusMutation.mutate({ id: row.id, action: "cancel" })}
                                    disabled={pending}
                                  >
                                    Cancel
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </RequireAuth>
  );
}
