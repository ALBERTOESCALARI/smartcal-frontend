

"use client";

import { clockIn, clockOut } from "@/lib/api";
import { useState } from "react";

export default function ClockControls() {
  const [status, setStatus] = useState<"idle" | "working">("idle");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClockIn = async () => {
    try {
      setLoading(true);
      setError(null);
      await clockIn("dummy-shift-id"); // replace with actual shift id from context/props
      setStatus("working");
    } catch (err: any) {
      setError(err.message || "Clock-in failed");
    } finally {
      setLoading(false);
    }
  };

  const handleClockOut = async () => {
    try {
      setLoading(true);
      setError(null);
      await clockOut();
      setStatus("idle");
    } catch (err: any) {
      setError(err.message || "Clock-out failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded-md bg-gray-50">
      <h2 className="text-lg font-semibold mb-2">Time Tracking</h2>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      {status === "idle" ? (
        <button
          onClick={handleClockIn}
          disabled={loading}
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