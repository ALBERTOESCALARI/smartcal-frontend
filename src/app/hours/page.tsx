"use client";

import { useEffect, useState } from "react";


import RequireAuth from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useSession } from "@/features/auth/useSession";
import { fetchUserHours, saveAccruals, type UserHourSummary } from "@/features/timekeeping/api";
import { getTenantId } from "@/lib/tenants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function parseJwt<T = Record<string, unknown>>(token: string | null): T | null {
  try {
    if (!token) return null;
    const part = token.split(".")[1];
    const json =
      typeof window !== "undefined"
        ? atob(part.replace(/-/g, "+").replace(/_/g, "/"))
        : Buffer.from(part, "base64").toString();
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function formatHours(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCents(cents?: number | null, currency: string = "USD") {
  if (typeof cents !== "number" || Number.isNaN(cents)) return "—";
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency });
}

type DraftAccrual = { pto: string; sick: string; vacation: string };
type DraftState = Record<string, DraftAccrual>;

const numberHeaderClass = "px-4 py-3 font-medium text-right";
const numberSubheaderClass = "px-4 pb-2 text-right text-xs text-muted-foreground";
const numberCellClass = "px-4 py-3 text-right align-middle font-mono tabular-nums";
const accrualHeaderClass = "px-4 py-3 font-medium text-center";
const accrualCellClass = "px-2 py-3 text-right align-middle";
const accrualInputClass = "h-8 w-24 text-right font-mono tabular-nums";
const actionCellClass = "px-4 py-3 text-right align-middle whitespace-nowrap";

export default function HoursPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: sessionUser } = useSession();

  interface TokenClaims {
    role?: string;
    roles?: string[];
  }

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const claims = parseJwt<TokenClaims>(token);
  const tokenRole =
    typeof claims?.role === "string"
      ? claims.role
      : Array.isArray(claims?.roles)
      ? claims.roles[0]
      : undefined;

  const role = String(sessionUser?.role || tokenRole || "member").toLowerCase();
  const isAdmin = role === "admin";

  useEffect(() => {
    setTenantId(getTenantId());
  }, []);

  const hoursQuery = useQuery<UserHourSummary[]>({
    queryKey: ["timekeeping", "hours", tenantId],
    // fetchUserHours internally requests include_earnings=true (non-breaking)
    queryFn: () => fetchUserHours(tenantId ?? ""),
    enabled: Boolean(tenantId) && isAdmin,
    staleTime: 60 * 1000,
  });

  const [drafts, setDrafts] = useState<DraftState>({});

  useEffect(() => {
    if (!Array.isArray(hoursQuery.data)) return;
    setDrafts((prev) => {
      const next: DraftState = {};
      for (const row of hoursQuery.data ?? []) {
        const id = (row as any).userId;
        const existing = prev[id];
        next[id] = {
          pto: existing?.pto ?? String((row as any).accruals?.pto ?? 0),
          sick: existing?.sick ?? String((row as any).accruals?.sick ?? 0),
          vacation: existing?.vacation ?? String((row as any).accruals?.vacation ?? 0),
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
        return current.map((item: any) => (item.userId === (updated as any).userId ? { ...item, ...updated } : item));
      });
      setDrafts((prev) => ({
        ...prev,
        [(updated as any).userId]: {
          pto: String((updated as any).accruals?.pto ?? 0),
          sick: String((updated as any).accruals?.sick ?? 0),
          vacation: String((updated as any).accruals?.vacation ?? 0),
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

  const rows = hoursQuery.data ?? [];
  const isSaving = saveMutation.isPending;

  // Compute a header total (non-breaking; shows 0 if backend doesn't send earnings)
  const totalCents = rows.reduce((sum: number, r: any) => {
    const cents =
      typeof r.computed_earnings_cents === "number"
        ? r.computed_earnings_cents
        : typeof r.computedEarningsCents === "number"
        ? r.computedEarningsCents
        : 0;
    return sum + cents;
  }, 0);

  if (!isAdmin) {
    return (
      <RequireAuth>
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
          <Card className="p-4 text-sm text-muted-foreground">
            You need administrator privileges to view or edit hour summaries.
          </Card>
        </div>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Hours &amp; Accruals</h1>
            <p className="text-sm text-muted-foreground">
              Track worked hours and leave balances for your team.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {tenantId && (
              <span className="rounded-full border border-muted-foreground/30 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Agency: {tenantId}
              </span>
            )}
            <span className="rounded-full border border-muted-foreground/30 px-3 py-1 text-xs font-mono tabular-nums">
              Total: {(totalCents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })}
            </span>
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
            Set an active agency to view hour summaries.
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
              <table className="w-full min-w-[880px] border-collapse text-sm">
                <thead className="bg-muted/60">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className={numberHeaderClass}>Regular</th>
                    <th className={numberHeaderClass}>Overtime</th>
                    <th className={numberHeaderClass}>PTO</th>
                    <th className={numberHeaderClass}>Sick</th>
                    <th className={numberHeaderClass}>Vacation</th>
                    <th className={accrualHeaderClass} colSpan={3}>
                      Accruals (defaults to 0)
                    </th>
                    <th className={numberHeaderClass}>Earnings</th>
                    <th className="px-4 py-3" />
                  </tr>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 pb-2" />
                    <th className={numberSubheaderClass}>hrs</th>
                    <th className={numberSubheaderClass}>hrs</th>
                    <th className={numberSubheaderClass}>hrs</th>
                    <th className={numberSubheaderClass}>hrs</th>
                    <th className={numberSubheaderClass}>hrs</th>
                    <th className={numberSubheaderClass}>PTO</th>
                    <th className={numberSubheaderClass}>Sick</th>
                    <th className={numberSubheaderClass}>Vacation</th>
                    <th className={numberSubheaderClass}>USD</th>
                    <th className="px-4 pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row: any) => {
                    const draft = drafts[row.userId] ?? { pto: "0", sick: "0", vacation: "0" };
                    const pending = isSaving && savingUserId === row.userId;
                    // Support either camelCase or snake_case from the API
                    const cents: number | undefined =
                      typeof row.computed_earnings_cents === "number"
                        ? row.computed_earnings_cents
                        : typeof row.computedEarningsCents === "number"
                        ? row.computedEarningsCents
                        : undefined;

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
                        <td className={numberCellClass}>{formatHours(row.regularHours)}</td>
                        <td className={numberCellClass}>{formatHours(row.overtimeHours)}</td>
                        <td className={numberCellClass}>{formatHours(row.ptoHours)}</td>
                        <td className={numberCellClass}>{formatHours(row.sickHours)}</td>
                        <td className={numberCellClass}>{formatHours(row.vacationHours)}</td>
                        <td className={accrualCellClass}>
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
                            className={accrualInputClass}
                          />
                        </td>
                        <td className={accrualCellClass}>
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
                            className={accrualInputClass}
                          />
                        </td>
                        <td className={accrualCellClass}>
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
                            className={accrualInputClass}
                          />
                        </td>
                        <td className={numberCellClass}>{formatCents(cents, "USD")}</td>
                        <td className={actionCellClass}>
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