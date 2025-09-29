"use client";

import { clockIn, clockOut, getClockStatus } from "@/lib/api";
import { requireBrowserLocation } from "@/lib/location";
import { useToast } from "@/components/ui/use-toast";
import { useEffect, useMemo, useState } from "react";

/**
 * ClockControls
 * - Admin/Scheduler: can always clock in (shift optional depending on backend policy)
 * - Member: must be assigned to the provided shiftId
 */

type Role = "admin" | "scheduler" | "member" | (string & {});

type ClockEventType = "clock-in" | "clock-out";

type ClockEvent = {
  type: ClockEventType;
  when: Date;
  location?: string;
};

export interface ClockControlsProps {
  /** Authenticated user's id */
  currentUserId: string;
  /** Authenticated user's role */
  currentUserRole?: Role;
  /** The shift being acted upon */
  shiftId?: string; // required for members
  /** The user currently assigned to this shift (if any) */
  assignedUserId?: string | null;
  className?: string;
}

export default function ClockControls({
  currentUserId,
  currentUserRole,
  shiftId,
  assignedUserId,
  className,
}: ClockControlsProps) {
  const [status, setStatus] = useState<"idle" | "working">("idle");
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<ClockEvent | null>(null);
  const { toast } = useToast();

  const adminLike = useMemo(
    () => ["admin", "scheduler"].includes((currentUserRole || "").toString().toLowerCase()),
    [currentUserRole]
  );

  // Members can clock in only if a shift exists and they are assigned to it
  const memberAssigned = useMemo(() => {
    if (!shiftId) return false;
    if (!assignedUserId) return false;
    return String(assignedUserId) === String(currentUserId);
  }, [shiftId, assignedUserId, currentUserId]);

  const canClockIn = adminLike || memberAssigned;

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      try {
        const statusResponse = await getClockStatus();
        if (cancelled) return;
        setStatus(statusResponse.status === "clocked_in" ? "working" : "idle");

        const entry = statusResponse.open_entry;
        if (entry) {
          const possibleDateFields = [
            "clock_in",
            "clock_in_at",
            "started_at",
            "start_time",
            "created_at",
          ];

          const dateValue = possibleDateFields
            .map((field) => entry?.[field])
            .find((value) => typeof value === "string" && value);

          if (typeof dateValue === "string" && dateValue) {
            const when = new Date(dateValue);
            if (!Number.isNaN(when.getTime())) {
              setLastEvent({
                type: "clock-in",
                when,
                location: entry?.location ?? entry?.clock_in_location ?? undefined,
              });
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load clock status", err);
          const fallbackMessage = (err as Error)?.message || "Unable to load current clock status";
          setError((prev) => prev ?? fallbackMessage);
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleClockIn() {
    try {
      setLoading(true);
      setError(null);

      if (!adminLike) {
        if (!shiftId) throw new Error("No shift selected");
        if (!memberAssigned) throw new Error("You are not assigned to this shift");
      }

      const location = await requireBrowserLocation();

      await clockIn(shiftId || "", location);
      const when = new Date();
      setStatus("working");
      setLastEvent({ type: "clock-in", when, location });
      toast({
        title: "Clocked in",
        description: `Recorded at ${formatter.format(when)}.`,
      });
    } catch (err: any) {
      setError(err?.message || "Clock-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleClockOut() {
    try {
      setLoading(true);
      setError(null);
      const location = await requireBrowserLocation();

      await clockOut(undefined, location);
      const when = new Date();
      setStatus("idle");
      setLastEvent({ type: "clock-out", when, location });
      toast({
        title: "Clocked out",
        description: `Recorded at ${formatter.format(when)}.`,
      });
    } catch (err: any) {
      setError(err?.message || "Clock-out failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={"p-4 border rounded-md bg-gray-50 " + (className || "")}>
      <h2 className="text-lg font-semibold mb-2">Time Tracking</h2>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      {initializing && (
        <p className="text-sm text-slate-500 mb-2">Checking your current status…</p>
      )}
      {lastEvent && (
        <p className="text-sm text-slate-600 mb-3">
          Last {lastEvent.type === "clock-in" ? "clock-in" : "clock-out"} at {formatter.format(lastEvent.when)}
          {lastEvent.location ? ` · ${lastEvent.location}` : ""}
        </p>
      )}

      {status === "idle" ? (
        <button
          onClick={handleClockIn}
          disabled={loading || initializing || !canClockIn}
          title={!canClockIn ? "You are not assigned to this shift" : undefined}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? "Clocking in..." : "Clock In"}
        </button>
      ) : (
        <button
          onClick={handleClockOut}
          disabled={loading || initializing}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Clocking out..." : "Clock Out"}
        </button>
      )}
    </div>
  );
}
