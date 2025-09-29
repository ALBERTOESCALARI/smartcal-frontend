"use client";

import RequireAuth from "@/components/require-auth";
import ClockControls from "@/components/time/clock-controls";
import { Card } from "@/components/ui/card";
import { getClockStatus } from "@/lib/api"; // must exist in api.ts
import { loadSessionUser, type SessionUser } from "@/lib/auth";
import { useEffect, useMemo, useState } from "react";

interface ClockStatus {
  clocked_in: boolean;
  clock_in?: string; // ISO datetime string
}

export default function ClockPage() {
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [status, setStatus] = useState<ClockStatus | null>(null);
  const [elapsed, setElapsed] = useState<string>("");

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
        // API returns: { status: "clocked_in" | "clocked_out", open_entry?: { clock_in: string, ... } }
        const api = (await getClockStatus()) as {
          status: "clocked_in" | "clocked_out";
          open_entry?: { clock_in?: string };
        };

        const mapped: ClockStatus = {
          clocked_in: api.status === "clocked_in",
          clock_in: api.open_entry?.clock_in,
        };

        if (!cancelled) setStatus(mapped);
      } catch (err) {
        console.error("Failed to fetch clock status", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionUser]);

  // Poll status so the banner flips quickly after clock in/out
  useEffect(() => {
    if (!sessionUser) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const api = (await getClockStatus()) as {
          status: "clocked_in" | "clocked_out";
          open_entry?: { clock_in?: string };
        };
        const mapped: ClockStatus = {
          clocked_in: api.status === "clocked_in",
          clock_in: api.open_entry?.clock_in,
        };
        if (!cancelled) setStatus(mapped);
      } catch {
        /* keep last known state */
      }
    };

    // fast for first 15s, then 3s
    const fastId = setInterval(tick, 1000);
    const slowTimer = setTimeout(() => {
      clearInterval(fastId);
      const slowId = setInterval(tick, 3000);
      (window as any).__clockSlow = slowId;
    }, 15000);

    // kick once immediately
    void tick();

    return () => {
      cancelled = true;
      clearInterval(fastId);
      clearTimeout(slowTimer);
      const slowId = (window as any).__clockSlow;
      if (slowId) clearInterval(slowId);
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
                className="w-full"
              />
            </>
          ) : (
            <p className="text-sm text-slate-500">Loading your profile…</p>
          )}
        </Card>
      </main>
    </RequireAuth>
  );
}