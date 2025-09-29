"use client";

import { clockIn, clockOut } from "@/lib/api";
import { useMemo, useState } from "react";

export type Role = "admin" | "scheduler" | "member" | (string & {});

export interface ClockEvent {
  when: Date;
  location?: string | null;
}

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
  /** Callback fired after a successful clock-in */
  onAfterClockIn?: (e: ClockEvent) => void;
  /** Callback fired after a successful clock-out */
  onAfterClockOut?: (e: ClockEvent) => void;
}

async function getBrowserLocation(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0,
      });
    });
    const { latitude, longitude } = pos.coords;
    if (
      typeof latitude === "number" &&
      isFinite(latitude) &&
      typeof longitude === "number" &&
      isFinite(longitude)
    ) {
      return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    }
    return null;
  } catch {
    return null; // gracefully continue without location
  }
}

export default function ClockControls({
  currentUserId,
  currentUserRole,
  shiftId,
  assignedUserId,
  className,
  onAfterClockIn,
  onAfterClockOut,
}: ClockControlsProps) {
  const [status, setStatus] = useState<"idle" | "working">("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleClockIn = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!adminLike) {
        if (!shiftId) throw new Error("No shift selected");
        if (!memberAssigned) throw new Error("You are not assigned to this shift");
      }

      const loc = await getBrowserLocation();
      await clockIn(shiftId || "", loc || undefined);
      const when = new Date();
      setStatus("working");
      onAfterClockIn?.({ when, location: loc });
    } catch (err: any) {
      setError(err?.message || "Clock-in failed");
    } finally {
      setLoading(false);
    }
  };

  const handleClockOut = async () => {
    try {
      setLoading(true);
      setError(null);
      const loc = await getBrowserLocation();
      await clockOut(undefined, loc || undefined);
      const when = new Date();
      setStatus("idle");
      onAfterClockOut?.({ when, location: loc });
    } catch (err: any) {
      setError(err?.message || "Clock-out failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={"p-4 border rounded-md bg-gray-50 " + (className || "")}>
      <h2 className="text-lg font-semibold mb-2">Time Tracking</h2>
      {error && <p className="text-red-600 mb-2">{error}</p>}

      {status === "idle" ? (
        <button
          onClick={handleClockIn}
          disabled={loading || !canClockIn}
          title={!canClockIn ? "You are not assigned to this shift" : undefined}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? "Clocking in..." : "Clock In"}
        </button>
      ) : (
        <button
          onClick={handleClockOut}
          disabled={loading}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? "Clocking out..." : "Clock Out"}
        </button>
      )}
    </div>
  );
}