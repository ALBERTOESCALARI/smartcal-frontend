"use client";

import { clockIn, clockOut } from "@/lib/api";
import { useMemo, useState } from "react";

/**
 * ClockControls
 * - Admin/Scheduler: can always clock in (shift optional depending on backend policy)
 * - Member: must be assigned to the provided shiftId
 */

type Role = "admin" | "scheduler" | "member" | (string & {});

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

  async function handleClockIn() {
    try {
      setLoading(true);
      setError(null);

      if (!adminLike) {
        if (!shiftId) throw new Error("No shift selected");
        if (!memberAssigned) throw new Error("You are not assigned to this shift");
      }

      // Our API helper requires a string; admins can pass shiftId or an empty string based on backend policy
      await clockIn(shiftId || "");
      setStatus("working");
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
      await clockOut();
      setStatus("idle");
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