"use client";

import { useEffect, useMemo, useState } from "react";

import RequireAuth from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import {
  approvePtoRequest,
  cancelPtoRequest,
  createPtoRequest,
  denyPtoRequest,
  fetchPtoRequests,
  type PtoCategory,
  type PtoRequest,
} from "@/features/requests/pto/api";
import { fetchUsers, type User } from "@/features/users/api";
import { getTenantId } from "@/lib/tenants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function toIso(date: string, fallback?: string): string {
  if (!date) return fallback ?? new Date().toISOString();
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return fallback ?? new Date().toISOString();
  }
  return parsed.toISOString();
}

function formatDateRange(start: string, end: string): string {
  try {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const sameDay =
      startDate.getFullYear() === endDate.getFullYear() &&
      startDate.getMonth() === endDate.getMonth() &&
      startDate.getDate() === endDate.getDate();

    const formatter = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: sameDay ? undefined : "numeric",
    });

    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

    if (sameDay) {
      return `${formatter.format(startDate)} · ${timeFormatter.format(startDate)} → ${timeFormatter.format(endDate)}`;
    }

    return `${formatter.format(startDate)} → ${formatter.format(endDate)}`;
  } catch {
    return `${start} → ${end}`;
  }
}

function formatStatus(status: PtoRequest["status"]): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "denied":
      return "Denied";
    case "cancelled":
    case "canceled":
      return "Cancelled";
    default:
      return "Pending";
  }
}

function statusColor(status: PtoRequest["status"]): string {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-800";
    case "denied":
      return "bg-red-100 text-red-700";
    case "cancelled":
    case "canceled":
      return "bg-gray-200 text-gray-700";
    default:
      return "bg-amber-100 text-amber-700";
  }
}

type FormState = {
  userId: string;
  type: PtoCategory;
  start: string;
  end: string;
  hours: string;
  notes: string;
};

const DEFAULT_FORM: FormState = {
  userId: "",
  type: "pto",
  start: "",
  end: "",
  hours: "8",
  notes: "",
};

export default function PtoRequestsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
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

  const ptoQuery = useQuery<PtoRequest[]>({
    queryKey: ["requests", "pto", tenantId],
    queryFn: () => fetchPtoRequests(tenantId ?? ""),
    enabled: Boolean(tenantId),
    staleTime: 30 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Select a tenant before creating PTO requests");
      if (!form.userId) throw new Error("Choose an employee");
      const startIso = toIso(form.start);
      const endIso = toIso(form.end, startIso);
      const hours = Number.parseFloat(form.hours || "0");
      if (!Number.isFinite(hours)) throw new Error("Hours must be a number");
      return createPtoRequest(tenantId, {
        userId: form.userId,
        start: startIso,
        end: endIso,
        hours,
        type: form.type,
        notes: form.notes?.trim() || undefined,
      });
    },
    onSuccess: (created) => {
      queryClient.setQueryData<PtoRequest[]>(["requests", "pto", tenantId], (current) => {
        const list = Array.isArray(current) ? current.slice() : [];
        list.unshift(created);
        return list;
      });
      setForm(DEFAULT_FORM);
      toast({ title: "PTO request created" });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "Failed to create PTO";
      toast({ title: "Unable to create PTO", description: message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, action, note }: { id: string; action: "approve" | "deny" | "cancel"; note?: string }) => {
      if (!tenantId) throw new Error("Missing tenant");
      setStatusTarget(id);
      if (action === "approve") return approvePtoRequest(tenantId, id);
      if (action === "deny") return denyPtoRequest(tenantId, id, note);
      return cancelPtoRequest(tenantId, id, note);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<PtoRequest[]>(["requests", "pto", tenantId], (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((item) => (item.id === updated.id ? updated : item));
      });
      toast({ title: `Request ${formatStatus(updated.status)}` });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "Request update failed";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    },
    onSettled: () => {
      setStatusTarget(null);
    },
  });

  const userOptions = useMemo(() => {
    if (!Array.isArray(usersQuery.data)) return [] as Array<{ id: string; label: string }>;
    return usersQuery.data
      .map((user) => {
        const name = (user.name || "").trim();
        const email = (user.email || "").trim();
        const label = name || (email ? (email.includes("@") ? email.split("@")[0] : email) : `User ${user.id}`);
        return { id: user.id, label, suffix: user.employee_id ? ` • ${user.employee_id}` : "" };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [usersQuery.data]);

  const rows = useMemo(() => ptoQuery.data ?? [], [ptoQuery.data]);

  return (
    <RequireAuth>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">PTO Requests</h1>
            <p className="text-sm text-muted-foreground">Submit, review, and act on time-off requests.</p>
          </div>
          <Button variant="outline" onClick={() => ptoQuery.refetch()} disabled={ptoQuery.isFetching}>
            {ptoQuery.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {!tenantId ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Set an active tenant to manage PTO requests.
          </Card>
        ) : (
          <>
            <Card className="space-y-4 p-4">
              <div>
                <h2 className="text-lg font-medium">New PTO Request</h2>
                <p className="text-sm text-muted-foreground">Create a new request on behalf of a team member.</p>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  createMutation.mutate();
                }}
                className="grid gap-4 md:grid-cols-2"
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Employee</span>
                  <select
                    value={form.userId}
                    onChange={(event) => setForm((prev) => ({ ...prev, userId: event.target.value }))}
                    className="h-9 rounded-md border border-input bg-background px-3"
                    required
                    disabled={usersQuery.isLoading || usersQuery.isError}
                  >
                    <option value="">Select employee…</option>
                    {userOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                        {option.suffix}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Request type</span>
                  <select
                    value={form.type}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, type: event.target.value as PtoCategory }))
                    }
                    className="h-9 rounded-md border border-input bg-background px-3"
                  >
                    <option value="pto">Paid time off</option>
                    <option value="vacation">Vacation</option>
                    <option value="sick">Sick</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="other">Other</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Start date</span>
                  <Input
                    type="date"
                    value={form.start}
                    onChange={(event) => setForm((prev) => ({ ...prev, start: event.target.value }))}
                    required
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">End date</span>
                  <Input
                    type="date"
                    value={form.end}
                    onChange={(event) => setForm((prev) => ({ ...prev, end: event.target.value }))}
                    required
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Hours</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.25"
                    value={form.hours}
                    onChange={(event) => setForm((prev) => ({ ...prev, hours: event.target.value }))}
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm md:col-span-2">
                  <span className="font-medium">Notes</span>
                  <textarea
                    value={form.notes}
                    onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                    className="min-h-[80px] rounded-md border border-input bg-background px-3 py-2"
                    placeholder="Optional"
                  />
                </label>

                <div className="md:col-span-2">
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Submitting…" : "Submit request"}
                  </Button>
                </div>
              </form>
            </Card>

            {ptoQuery.isLoading ? (
              <Card className="p-4 text-sm text-muted-foreground">Loading PTO requests…</Card>
            ) : ptoQuery.isError ? (
              <Card className="p-4 text-sm text-red-600">
                {(ptoQuery.error as Error)?.message || "Failed to load PTO requests"}
              </Card>
            ) : rows.length === 0 ? (
              <Card className="p-4 text-sm text-muted-foreground">No PTO requests yet.</Card>
            ) : (
              <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-sm">
                    <thead className="bg-muted/60">
                      <tr className="text-left">
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Period</th>
                        <th className="px-4 py-3 font-medium text-right">Hours</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Notes</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const label = formatStatus(row.status);
                        const isPending = statusTarget === row.id && statusMutation.isPending;
                        return (
                          <tr key={row.id} className="border-t">
                            <td className="px-4 py-3 align-top">
                              <div className="flex flex-col">
                                <span className="font-medium">{row.userName}</span>
                                <span className="text-xs text-muted-foreground">
                                  {row.employeeId ? `ID ${row.employeeId}` : row.userEmail ?? ""}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top capitalize">{row.type}</td>
                            <td className="px-4 py-3 align-top">{formatDateRange(row.start, row.end)}</td>
                            <td className="px-4 py-3 align-top text-right">{row.hours.toFixed(2)}</td>
                            <td className="px-4 py-3 align-top">
                              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusColor(row.status)}`}>
                                {label}
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
                                      onClick={() => statusMutation.mutate({ id: row.id, action: "approve" })}
                                      disabled={isPending}
                                    >
                                      {isPending && statusTarget === row.id ? "Updating…" : "Approve"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        const note = window.prompt("Optional reason for denial:");
                                        statusMutation.mutate({ id: row.id, action: "deny", note: note ?? undefined });
                                      }}
                                      disabled={isPending}
                                    >
                                      Deny
                                    </Button>
                                  </>
                                )}
                                {row.status !== "cancelled" && row.status !== "canceled" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const note = window.prompt("Optional note for cancellation:");
                                      statusMutation.mutate({ id: row.id, action: "cancel", note: note ?? undefined });
                                    }}
                                    disabled={isPending}
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

