"use client";

import RequireAuth from "@/components/require-auth";
import ClockControls from "@/components/time/clock-controls";
import { Card } from "@/components/ui/card";
import { fetchShifts, type Shift } from "@/features/shifts/api";
import {
  getActiveTenantId,
  getClockStatus,
  getMyTimeEntries,
  type TimeEntryOut,
} from "@/lib/api"; // must exist in api.ts
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
  const [history, setHistory] = useState<TimeEntryOut[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

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
    if (!sessionUser?.id) {
      setActiveShift(null);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const loadActiveShift = async () => {
      try {
        const tenantId = getActiveTenantId();
        if (!tenantId) return;
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
  }, [sessionUser?.id, status?.clocked_in]);

  useEffect(() => {
    if (!sessionUser?.id) {
      setHistory(null);
      setHistoryLoading(false);
      setHistoryError(null);
      return;
    }

    let cancelled = false;

    const loadHistory = async () => {
      try {
        setHistoryLoading(true);
        setHistoryError(null);
        const entries = await getMyTimeEntries({ limit: 90 });
        if (!cancelled) setHistory(entries);
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error && err.message ? err.message : "Unable to load history";
          setHistoryError(message);
          setHistory(null);
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [sessionUser?.id, status?.clock_in, status?.clocked_in]);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }),
    []
  );
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { timeStyle: "short" }),
    []
  );

  const sortedHistory = useMemo(() => {
    if (!history) return [] as TimeEntryOut[];
    return [...history].sort((a, b) => {
      const aTime = Date.parse(a.clock_in ?? "");
      const bTime = Date.parse(b.clock_in ?? "");
      if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
      if (Number.isNaN(aTime)) return 1;
      if (Number.isNaN(bTime)) return -1;
      return bTime - aTime;
    });
  }, [history]);

  function deriveLocation(entry: TimeEntryOut, phase: "in" | "out") {
    const prefix = phase === "in" ? "clock_in" : "clock_out";
    const locationValue = (entry as any)[`${prefix}_location`] ?? entry.location ?? null;
    const lat = (entry as any)[`${prefix}_latitude`] ?? entry.latitude ?? null;
    const lng = (entry as any)[`${prefix}_longitude`] ?? entry.longitude ?? null;
    const mapUrl = (entry as any)[`${prefix}_map_url`] ?? entry.map_url ?? null;

    let label: string | undefined;
    if (typeof locationValue === "string" && locationValue) label = locationValue;
    if (!label && typeof lat === "number" && typeof lng === "number") {
      label = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    }

    let href: string | undefined;
    if (typeof mapUrl === "string" && mapUrl) href = mapUrl;
    else if (typeof lat === "number" && typeof lng === "number") {
      href = `https://www.google.com/maps?q=${lat},${lng}`;
    }

    return { label, href };
  }

  // Poll status so the banner flips quickly after clock in/out
  // Poll status so the banner flips quickly after clock in/out
  useEffect(() => {
    if (!sessionUser) return;

    let cancelled = false;
    let fastId: number | undefined;
    let slowId: number | undefined;
    let slowSwitchTimer: number | undefined;

    const tick = async () => {
      try {
        const api = (await getClockStatus()) as {
          status: "clocked_in" | "clocked_out";
          open_entry?: { clock_in?: string };
        };
        if (!cancelled) setStatus(mapApiToClockStatus(api));
      } catch {
        // keep last known state
      }
    };

    // kick once immediately, then fast poll for 15s, then slow poll
    void tick();
    fastId = window.setInterval(tick, 1000);
    slowSwitchTimer = window.setTimeout(() => {
      if (fastId) window.clearInterval(fastId);
      slowId = window.setInterval(tick, 3000);
    }, 15000);

    return () => {
      cancelled = true;
      if (fastId) window.clearInterval(fastId);
      if (slowId) window.clearInterval(slowId);
      if (slowSwitchTimer) window.clearTimeout(slowSwitchTimer);
    };
  }, [sessionUser]);

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
          <p className="text-sm text-slate-600">
            Location access may be requested to enforce geofencing for your shift.
          </p>
        </header>

        <Card className="space-y-3 p-4">
          {hydrated && canRenderControls ? (
            <>
              {status ? (
               status.clocked_in ?(
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
            <p className="text-sm text-slate-500">Loading your profile…</p>
          )}
        </Card>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">History</h2>
            <p className="text-xs text-slate-500">Last 90 days</p>
          </div>

          {historyLoading ? (
            <p className="text-sm text-slate-500">Loading entries…</p>
          ) : historyError ? (
            <p className="text-sm text-red-600">{historyError}</p>
          ) : sortedHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 pr-4 font-medium">Date</th>
                    <th className="pb-2 pr-4 font-medium">Clock in</th>
                    <th className="pb-2 font-medium">Clock out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sortedHistory.map((entry) => {
                    const clockInDate = entry.clock_in ? new Date(entry.clock_in) : null;
                    const clockOutDate = entry.clock_out ? new Date(entry.clock_out) : null;
                    const dateLabel = clockInDate
                      ? dateFormatter.format(clockInDate)
                      : clockOutDate
                      ? dateFormatter.format(clockOutDate)
                      : "—";
                    const inLocation = deriveLocation(entry, "in");
                    const outLocation = deriveLocation(entry, "out");
                    return (
                      <tr key={entry.id} className="align-top">
                        <td className="py-3 pr-4 text-slate-700">{dateLabel}</td>
                        <td className="py-3 pr-4 text-slate-700">
                          {clockInDate ? timeFormatter.format(clockInDate) : "—"}
                          {inLocation.label ? (
                            <div className="text-xs text-slate-500">
                              {inLocation.href ? (
                                <a
                                  href={inLocation.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  {inLocation.label}
                                </a>
                              ) : (
                                inLocation.label
                              )}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-3 text-slate-700">
                          {clockOutDate ? timeFormatter.format(clockOutDate) : "—"}
                          {outLocation.label ? (
                            <div className="text-xs text-slate-500">
                              {outLocation.href ? (
                                <a
                                  href={outLocation.href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  {outLocation.label}
                                </a>
                              ) : (
                                outLocation.label
                              )}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No time entries yet.</p>
          )}
        </section>
      </main>
    </RequireAuth>
  );
}
