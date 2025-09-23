"use client";

import { useEffect, useMemo, useState } from "react";

import RequireAuth from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { fetchUserHours, saveAccruals, type UserHourSummary } from "@/features/timekeeping/api";
import { getTenantId } from "@/lib/tenants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function formatHours(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type DraftAccrual = { pto: string; sick: string; vacation: string };

type DraftState = Record<string, DraftAccrual>;

export default function HoursPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    setTenantId(getTenantId());
  }, []);

  const hoursQuery = useQuery<UserHourSummary[]>({
    queryKey: ["timekeeping", "hours", tenantId],
    queryFn: () => fetchUserHours(tenantId ?? ""),
    enabled: Boolean(tenantId),
    staleTime: 60 * 1000,
  });

  const [drafts, setDrafts] = useState<DraftState>({});

  useEffect(() => {
    if (!Array.isArray(hoursQuery.data)) return;
    setDrafts((prev) => {
      const next: DraftState = {};
      for (const row of hoursQuery.data ?? []) {
        const id = row.userId;
        const existing = prev[id];
        next[id] = {
          pto: existing?.pto ?? String(row.accruals?.pto ?? 0),
          sick: existing?.sick ?? String(row.accruals?.sick ?? 0),
          vacation: existing?.vacation ?? String(row.accruals?.vacation ?? 0),
        };
      }
      return next;
    });
  }, [hoursQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async ({ userId, accrual }: { userId: string; accrual: DraftAccrual }) => {
      if (!tenantId) throw new Error("Select a tenant before saving accruals");
      setSavingUserId(userId);
      const payload = {
        pto: Number.parseFloat(accrual.pto || "0"),
        sick: Number.parseFloat(accrual.sick || "0"),
        vacation: Number.parseFloat(accrual.vacation || "0"),
      };
      return saveAccruals(tenantId, userId, payload);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<UserHourSummary[]>(["timekeeping", "hours", tenantId], (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((item) => (item.userId === updated.userId ? { ...item, ...updated } : item));
      });
      setDrafts((prev) => ({
        ...prev,
        [updated.userId]: {
          pto: String(updated.accruals.pto ?? 0),
          sick: String(updated.accruals.sick ?? 0),
          vacation: String(updated.accruals.vacation ?? 0),
        },
      }));
      toast({ title: "Accruals updated" });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
          ? error
          : "Failed to update accruals";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    },
    onSettled: () => {
      setSavingUserId(null);
    },
  });

  const rows = useMemo(() => hoursQuery.data ?? [], [hoursQuery.data]);

  const isSaving = saveMutation.isPending;

  return (
    <RequireAuth>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Hours & Accruals</h1>
            <p className="text-sm text-muted-foreground">
              Track worked hours and leave balances for your team.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => hoursQuery.refetch()}
              disabled={hoursQuery.isFetching}
            >
              {hoursQuery.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>

        {!tenantId ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Set an active tenant to view hour summaries.
          </Card>
        ) : hoursQuery.isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading hours…</Card>
        ) : hoursQuery.isError ? (
          <Card className="p-4 text-sm text-red-600">
            {(hoursQuery.error as Error)?.message || "Failed to load hours"}
          </Card>
        ) : rows.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            No hour data found. Once the backend exposes the /hours endpoint, values will appear here.
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead className="bg-muted/60">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium text-right">Regular</th>
                    <th className="px-4 py-3 font-medium text-right">Overtime</th>
                    <th className="px-4 py-3 font-medium text-right">PTO</th>
                    <th className="px-4 py-3 font-medium text-right">Sick</th>
                    <th className="px-4 py-3 font-medium text-right">Vacation</th>
                    <th className="px-4 py-3 font-medium" colSpan={3}>
                      Accruals (defaults to 0)
                    </th>
                    <th className="px-4 py-3" />
                  </tr>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th />
                    <th className="px-4 pb-2 text-right">hrs</th>
                    <th className="px-4 pb-2 text-right">hrs</th>
                    <th className="px-4 pb-2 text-right">hrs</th>
                    <th className="px-4 pb-2 text-right">hrs</th>
                    <th className="px-4 pb-2 text-right">hrs</th>
                    <th className="px-4 pb-2 text-right">PTO</th>
                    <th className="px-4 pb-2 text-right">Sick</th>
                    <th className="px-4 pb-2 text-right">Vacation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const draft = drafts[row.userId] ?? { pto: "0", sick: "0", vacation: "0" };
                    const pending = isSaving && savingUserId === row.userId;
                    return (
                      <tr key={row.userId} className="border-t">
                        <td className="px-4 py-3 align-middle">
                          <div className="flex flex-col">
                            <span className="font-medium">{row.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {row.employeeId ? `ID ${row.employeeId}` : row.email || ""}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          {formatHours(row.regularHours)}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          {formatHours(row.overtimeHours)}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          {formatHours(row.ptoHours)}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          {formatHours(row.sickHours)}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          {formatHours(row.vacationHours)}
                        </td>
                        <td className="px-2 py-3 text-right align-middle">
                          <Input
                            inputMode="decimal"
                            value={draft.pto}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [row.userId]: {
                                  ...draft,
                                  pto: event.target.value,
                                },
                              }))
                            }
                            className="h-8 w-24 text-right"
                          />
                        </td>
                        <td className="px-2 py-3 text-right align-middle">
                          <Input
                            inputMode="decimal"
                            value={draft.sick}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [row.userId]: {
                                  ...draft,
                                  sick: event.target.value,
                                },
                              }))
                            }
                            className="h-8 w-24 text-right"
                          />
                        </td>
                        <td className="px-2 py-3 text-right align-middle">
                          <Input
                            inputMode="decimal"
                            value={draft.vacation}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [row.userId]: {
                                  ...draft,
                                  vacation: event.target.value,
                                },
                              }))
                            }
                            className="h-8 w-24 text-right"
                          />
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <Button
                            size="sm"
                            onClick={() => saveMutation.mutate({ userId: row.userId, accrual: draft })}
                            disabled={pending || !tenantId}
                          >
                            {pending ? "Saving…" : "Save"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </RequireAuth>
  );
}
