"use client";

import { useEffect, useMemo, useState } from "react";

import RequireAuth from "@/components/require-auth";
import { Card } from "@/components/ui/card";
import { fetchShifts, type Shift } from "@/features/shifts/api";
import { fetchUnits, type Unit } from "@/features/units/api";
import { useQuery } from "@tanstack/react-query";
import { MessageCircleWarning } from "lucide-react";

function formatRange(startIso: string, endIso: string) {
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();

    const startFmt = start.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const endFmt = end.toLocaleString(undefined, {
      ...(sameDay ? {} : { month: "short", day: "numeric" }),
      hour: "numeric",
      minute: "2-digit",
    });

    return `${startFmt} → ${endFmt}`;
  } catch {
    return `${startIso} → ${endIso}`;
  }
}

export default function DashboardPage() {
  const [tenantId, setTenantId] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("tenant_id");
      if (stored) setTenantId(stored);
    } catch {}
  }, []);

  const unitsQuery = useQuery<Unit[]>(
    ["dashboard", "units", tenantId],
    () => fetchUnits(tenantId),
    { enabled: Boolean(tenantId), staleTime: 5 * 60 * 1000 }
  );

  const shiftsQuery = useQuery<Shift[]>(
    ["dashboard", "shifts", tenantId],
    () => fetchShifts(tenantId),
    { enabled: Boolean(tenantId), refetchInterval: 5 * 60 * 1000 }
  );

  const unitName = useMemo(() => {
    const map = new Map<string, string>();
    (unitsQuery.data || []).forEach((u) => {
      if (u.id) map.set(u.id, u.name ?? u.id);
    });
    return (id: string | null | undefined) => {
      if (!id) return "Unassigned unit";
      return map.get(id) ?? id;
    };
  }, [unitsQuery.data]);

  const alertShifts = useMemo(() => {
    if (!Array.isArray(shiftsQuery.data)) return [] as Shift[];
    const nowMs = Date.now();
    const horizonMs = nowMs + 36 * 60 * 60 * 1000; // 36 hours
    return shiftsQuery.data.filter((shift) => {
      if (shift.user_id) return false;
      const startMs = new Date(shift.start_time).getTime();
      if (Number.isNaN(startMs)) return false;
      return startMs > nowMs && startMs <= horizonMs;
    });
  }, [shiftsQuery.data]);

  const hasAlerts = alertShifts.length > 0;

  return (
    <RequireAuth>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">Welcome! This will show quick stats.</Card>

        <Card className="p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Today’s Chief Alert</h2>
              <p className="text-sm text-muted-foreground">
                Shifts without coverage inside the next 36 hours.
              </p>
            </div>
            {hasAlerts && (
              <span className="relative inline-flex items-center">
                <MessageCircleWarning className="h-6 w-6 text-red-600" aria-hidden />
                <span className="absolute -top-1 -right-1 inline-flex h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />
                <span className="sr-only">Unassigned shifts need attention</span>
              </span>
            )}
          </div>

          {!tenantId ? (
            <p className="text-sm text-muted-foreground">
              Set a tenant on the Shifts page to see alert data here.
            </p>
          ) : shiftsQuery.isLoading || unitsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking upcoming shifts…</p>
          ) : shiftsQuery.isError ? (
            <p className="text-sm text-red-600">
              {(shiftsQuery.error as Error)?.message || "Failed to load shifts"}
            </p>
          ) : alertShifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All shifts within the next 36 hours are currently covered.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-red-600">
                {alertShifts.length} shift{alertShifts.length > 1 ? "s" : ""} still need a signup.
              </p>
              <ul className="space-y-2">
                {alertShifts.map((shift) => (
                  <li
                    key={shift.id}
                    className="rounded-md border border-red-100 bg-red-50/70 px-3 py-2 text-sm shadow-sm"
                  >
                    <div className="font-medium text-red-700">
                      {unitName(shift.unit_id)}
                    </div>
                    <div className="text-xs text-red-600/80">
                      {formatRange(shift.start_time, shift.end_time)}
                    </div>
                    {shift.notes && (
                      <div className="mt-1 text-xs text-red-600/70">{shift.notes}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="p-4 md:col-span-2">Recent requests (PTO & swaps).</Card>
      </div>
    </RequireAuth>
  );
}
