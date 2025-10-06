"use client";
"use client";

import RequireAuth from "@/components/require-auth";
import ClockControls from "@/components/time/clock-controls";
import { Card } from "@/components/ui/card";
import { fetchShifts, type Shift } from "@/features/shifts/api";
import {
  getActiveTenantId,
  getClockStatus,
} from "@/lib/api";
import { loadSessionUser, type SessionUser } from "@/lib/auth";
import { useEffect, useMemo, useState } from "react";

interface ClockStatus {
  clocked_in: boolean;
  clock_in?: string; // ISO datetime string
}

// helper to map API -> ClockStatus
function mapApiToClockStatus(api: { status: "clocked_in" | "clocked_out"; open_entry?: { clock_in?: string } }): ClockStatus {
  return {
    clocked_in: api.status === "clocked_in",
    clock_in: api.open_entry?.clock_in,
  };
}


export default function ClockPage() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [status, setStatus] = useState<ClockStatus | null>(null);
  const [elapsed, setElapsed] = useState<string>("");
  const [activeShift, setActiveShift] = useState<Shift | null>(null);

  // Keep a stable view of the active tenant for this session
  const tenantId = useMemo(() => {
    try {
      return getActiveTenantId() || null;
    } catch {
      return null;
    }
  }, []);

  // Load session user once on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSessionUser(loadSessionUser());
    setHydrated(true);
  }, []);

  // Initial fetch: normalize API -> ClockStatus once we know the user
  useEffect(() => {
    if (!sessionUser) return;
    let cancelled = false;

    (async () => {
      try {
        const api = (await getClockStatus()) as {
          status: "clocked_in" | "clocked_out";
          open_entry?: { clock_in?: string };
        };
        if (!cancelled) setStatus(mapApiToClockStatus(api));
      } catch (err) {
        console.error("Failed to fetch clock status", err);
        if (!cancelled) setStatus({ clocked_in: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionUser]);

  // Discover currently active shift (if any) for the logged in user
  useEffect(() => {
    if (!sessionUser?.id || !tenantId) {
      setActiveShift(null);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const loadActiveShift = async () => {
      try {
        const shifts = await fetchShifts(tenantId, { user_id: sessionUser.id });
        const now = Date.now();
        const current = shifts.find((shift) => {
          const start = Date.parse(shift.start_time);
          const end = Date.parse(shift.end_time);
          if (Number.isNaN(start) || Number.isNaN(end)) return false;
          return start <= now && now <= end;
        });
        if (!cancelled) setActiveShift(current ?? null);
      } catch (err) {
        console.error("Failed to determine active shift", err);
        if (!cancelled) setActiveShift(null);
      }
    };

    void loadActiveShift();
    timer = window.setInterval(loadActiveShift, 60_000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [sessionUser?.id, status?.clocked_in, tenantId]);



  // Derive the start timestamp (ms) from status
  const startMs = useMemo(() => {
    if (!status?.clocked_in || !status.clock_in) return null;
    const t = Date.parse(status.clock_in);
    return Number.isNaN(t) ? null : t;
  }, [status]);

  // Live ticking timer while clocked in
  useEffect(() => {
    if (!startMs) {
      setElapsed("");
      return;
    }

    const format = (ms: number) => {
      const hrs = Math.floor(ms / 3_600_000);
      const mins = Math.floor((ms % 3_600_000) / 60_000);
      const secs = Math.floor((ms % 60_000) / 1_000);
      return `${hrs.toString().padStart(2, "0")}:${mins
        .toString()
        .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    // prime immediately
    setElapsed(format(Date.now() - startMs));

    const id = setInterval(() => {
      setElapsed(format(Date.now() - startMs));
    }, 1000);

    return () => clearInterval(id);
  }, [startMs]);

  const canRenderControls = Boolean(sessionUser?.id);

  return (
    <RequireAuth>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Clock In / Out</h1>
          {!tenantId ? (
            <p className="text-sm text-amber-700">
              No tenant selected. Choose a tenant before using the clock.
            </p>
          ) : (
            <p className="text-sm text-slate-600">
              Location access may be requested to enforce geofencing for your shift.
            </p>
          )}
        </header>

        <Card className="space-y-3 p-4">
          {hydrated && canRenderControls ? (
            tenantId ? (
              <>
                {status ? (
                  status.clocked_in ? (
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-green-600">✅ You are clocked in</p>
                      <p className="text-sm font-mono text-slate-700">
                        {elapsed || "00:00:00"}
                      </p>
                    </div>
                  ) : (
                    <p className="font-medium text-slate-600">⏸ You are clocked out</p>
                  )
                ) : (
                  <p className="text-slate-500">Loading status…</p>
                )}

                <ClockControls
                  currentUserId={sessionUser!.id}
                  currentUserRole={sessionUser!.role}
                  shiftId={activeShift?.id}
                  assignedUserId={activeShift?.user_id ?? null}
                  className="w-full"
                />
              </>
            ) : (
              <p className="text-sm text-slate-500">
                Select a tenant to enable clock actions.
              </p>
            )
          ) : (
            <p className="text-sm text-slate-500">Loading your profile…</p>
          )}
        </Card>

      </main>
    </RequireAuth>
  );
}