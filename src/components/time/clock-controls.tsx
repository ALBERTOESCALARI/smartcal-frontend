"use client";

import { clockIn, clockOut, getClockStatus } from "@/lib/api";
import { requireBrowserLocation } from "@/lib/location";
import { useToast } from "@/components/ui/use-toast";
import { isAxiosError } from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * ClockControls
 * - Allows any authenticated user to clock in/out for the active tenant
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
  /** Optional shift the clock event is associated with */
  shiftId?: string;
  /** Legacy assignment context (ignored by clock logic) */
  assignedUserId?: string | null;
  className?: string;
}

export default function ClockControls({ shiftId, className }: ClockControlsProps) {
  const [status, setStatus] = useState<"idle" | "working">("idle");
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<ClockEvent | null>(null);
  const { toast } = useToast();

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    []
  );

  const resolveErrorMessage = useCallback(
    (err: unknown, fallback: string) => {
      if (isAxiosError(err)) {
        if (err.code === "ERR_NETWORK") {
          if (
            typeof window !== "undefined" &&
            window.location.protocol === "https:" &&
            (process.env.NEXT_PUBLIC_API_BASE || "").startsWith("http://")
          ) {
            return "Network blocked: API is served over HTTP while the app uses HTTPS.";
          }
          return "Network error: could not reach the SmartCal API.";
        }
        const detail =
          (typeof err.response?.data === "string" && err.response.data) ||
          (err.response?.data as { detail?: string })?.detail;
        if (detail) return detail;
        if (err.response?.status) {
          return `Request failed (${err.response.status}).`;
        }
      }
      if (err instanceof Error && err.message) return err.message;
      return fallback;
    },
    []
  );

  const applyClockStatus = useCallback((statusResponse: any) => {
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
          let locationText = entry?.location ?? entry?.clock_in_location ?? entry?.clock_out_location ?? undefined;
          if (
            locationText &&
            typeof locationText === "object" &&
            "latitude" in locationText &&
            "longitude" in locationText
          ) {
            const lat = Number((locationText as any).latitude);
            const lon = Number((locationText as any).longitude);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              locationText = `${lat.toFixed(6)},${lon.toFixed(6)}`;
            }
          }
          setLastEvent({
            type: "clock-in",
            when,
            location: typeof locationText === "string" ? locationText : undefined,
          });
        }
      }
    }
  }, []);

  const hydrateStatus = useCallback(async () => {
    const statusResponse = await getClockStatus();
    applyClockStatus(statusResponse);
    return statusResponse;
  }, [applyClockStatus]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await hydrateStatus();
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load clock status", err);
          setError((prev) => prev ?? resolveErrorMessage(err, "Unable to load current clock status"));
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateStatus, resolveErrorMessage]);

  async function handleClockIn() {
    try {
      setLoading(true);
      setError(null);

      const location = await requireBrowserLocation();

      await clockIn(shiftId, location);
      const when = new Date();
      setStatus("working");
      setLastEvent({ type: "clock-in", when, location: location.formatted });
      toast({
        title: "Clocked in",
        description: `Recorded at ${formatter.format(when)}${location.formatted ? ` · ${location.formatted}` : ""}`,
      });
      try {
        await hydrateStatus();
      } catch (err) {
        console.warn("Could not refresh clock status after clock-in", err);
      }
    } catch (err: any) {
      setError(resolveErrorMessage(err, "Clock-in failed"));
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
      setLastEvent({ type: "clock-out", when, location: location.formatted });
      toast({
        title: "Clocked out",
        description: `Recorded at ${formatter.format(when)}${location.formatted ? ` · ${location.formatted}` : ""}`,
      });
      try {
        await hydrateStatus();
      } catch (err) {
        console.warn("Could not refresh clock status after clock-out", err);
      }
    } catch (err: any) {
      setError(resolveErrorMessage(err, "Clock-out failed"));
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
          disabled={loading || initializing}
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
