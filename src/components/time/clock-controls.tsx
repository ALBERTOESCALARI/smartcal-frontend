"use client";

import { useToast } from "@/components/ui/use-toast";
import { api, clockIn, clockOut, getClockStatus } from "@/lib/api";
import { requireBrowserLocation } from "@/lib/location";
import { earningsFromElapsedMs, formatCurrencyCents } from "@/lib/utils";
import { isAxiosError } from "axios";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * ClockControls
 * - Admin/Scheduler users can clock in/out regardless of shift selection
 * - Members must have an assigned shift to clock in/out
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
  const [rateCentsFromApi, setRateCentsFromApi] = useState<number | null>(null);

  // History dropdown state & filters
  type HistoryRow = {
    id: string;
    clock_in?: string | null;
    clock_out?: string | null;
    location?: string | null;
    hourly_rate_cents?: number | null;
    earnings?: number | null;
  };
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [histStart, setHistStart] = useState<string>("");
  const [histEnd, setHistEnd] = useState<string>("");
  const [histQuery, setHistQuery] = useState<string>("");

  // ⏱ live timer + earnings
const [elapsedLabel, setElapsedLabel] = useState("00:00:00");
const [liveEarningsCents, setLiveEarningsCents] = useState<number | null>(null);

// format ms -> HH:MM:SS
const fmtElapsed = (ms: number) => {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
};

// Detect "lat,lng" strings and build a Google Maps link
const isCoord = (txt?: string | null) => {
  if (!txt) return false;
  const m = txt.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return false;
  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
};
const coordLink = (txt: string) => {
  const [lat, lon] = txt.split(",").map((s) => s.trim());
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat)},${encodeURIComponent(lon)}`;
};

// Try to find an hourly rate (in cents) from common places.
// If you later pass a rate via props, swap this out.
const currentRateCents = useMemo(() => {
  // Prefer rate from API clock status if available
  if (rateCentsFromApi != null && Number.isFinite(Number(rateCentsFromApi))) {
    return Number(rateCentsFromApi);
  }
  if (typeof window === "undefined") return null;
  // Fallback sources you may already have on your app shell
  const fromShift = (window as any).__activeShift?.hourly_rate_cents ?? null;
  const fromUser  = (window as any).__sessionUser?.hourly_rate_cents ?? null;
  const fromLSRaw = window.localStorage?.getItem("hourly_rate_cents") ?? "";
  const fromLS    = Number(fromLSRaw);
  const candidate = fromShift ?? fromUser ?? (Number.isFinite(fromLS) ? fromLS : null);
  return Number.isFinite(candidate) ? Number(candidate) : null;
}, [rateCentsFromApi, shiftId]);

// tick every second while working
useEffect(() => {
  if (status !== "working" || !lastEvent?.when) {
    setElapsedLabel("00:00:00");
    setLiveEarningsCents(null);
    return;
  }

  const startMs = lastEvent.when.getTime();

  // prime immediately
  const primeDiff = Date.now() - startMs;
  setElapsedLabel(fmtElapsed(primeDiff));
  if (currentRateCents != null) {
    setLiveEarningsCents(earningsFromElapsedMs(primeDiff, currentRateCents));
  }

  const id = setInterval(() => {
    const diff = Date.now() - startMs;
    setElapsedLabel(fmtElapsed(diff));
    if (currentRateCents != null) {
      setLiveEarningsCents(earningsFromElapsedMs(diff, currentRateCents));
    }
  }, 1000);

  return () => clearInterval(id);
}, [status, lastEvent, currentUserId, currentRateCents]);
  const { toast } = useToast();

  const adminLike = useMemo(
    () => ["admin", "scheduler"].includes((currentUserRole || "").toString().toLowerCase()),
    [currentUserRole]
  );

  const assignedToShift = useMemo(() => {
    if (!shiftId) return false;
    if (!assignedUserId) return false;
    return String(assignedUserId) === String(currentUserId);
  }, [shiftId, assignedUserId, currentUserId]);

  const shiftRequired = !adminLike;
  const canActOnShift = adminLike || assignedToShift;

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

    // Capture hourly rate (in cents) from API if provided
    const apiRate =
      statusResponse?.hourly_rate_cents ??
      statusResponse?.open_entry?.hourly_rate_cents ??
      null;
    setRateCentsFromApi(
      apiRate != null && Number.isFinite(Number(apiRate)) ? Number(apiRate) : null
    );

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

  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      // build params
      const params: Record<string, any> = { limit: 200 };
      if (histStart) params.start = new Date(histStart).toISOString();
      if (histEnd) params.end = new Date(histEnd).toISOString();

      const { data } = await api.get<HistoryRow[]>("/time/me", { params });
      // optional client-side search by substring on location or timestamps
      const q = histQuery.trim().toLowerCase();
      const filtered = q
        ? data.filter((r) =>
            [
              r.location || "",
              r.clock_in || "",
              r.clock_out || "",
              String(r.earnings ?? ""),
            ]
              .join(" ")
              .toLowerCase()
              .includes(q)
          )
        : data;
      setHistoryRows(filtered);
    } catch (e) {
      console.error("Failed to load history", e);
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [histStart, histEnd, histQuery]);

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

  // Auto-load history when opened
  useEffect(() => {
    if (historyOpen) {
      void loadHistory();
    }
  }, [historyOpen, loadHistory]);

  async function handleClockIn() {
    try {
      setLoading(true);
      setError(null);

      if (shiftRequired && !shiftId) {
        throw new Error("A shift must be selected before clocking in.");
      }
      if (!canActOnShift) {
        throw new Error("You are not assigned to this shift.");
      }

      const location = await requireBrowserLocation();

      await clockIn({ shiftId: adminLike ? undefined : shiftId, location });
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

      if (shiftRequired && !shiftId) {
        throw new Error("A shift must be selected before clocking out.");
      }
      if (!canActOnShift) {
        throw new Error("You are not assigned to this shift.");
      }
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
      {/* History dropdown trigger */}
      <div className="mb-2">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="text-sm px-3 py-1 border rounded bg-white hover:bg-gray-100"
          aria-expanded={historyOpen}
          aria-controls="history-panel"
        >
          {historyOpen ? "Hide" : "Show"} History ▾
        </button>
      </div>

      {/* Collapsible history panel */}
      {historyOpen && (
        <div
          id="history-panel"
          className="mb-3 rounded border bg-white p-3 shadow-sm"
        >
          <div className="mb-2 grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600 w-16">Start</label>
              <input
                type="datetime-local"
                value={histStart}
                onChange={(e) => setHistStart(e.target.value)}
                className="w-full border rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600 w-16">End</label>
              <input
                type="datetime-local"
                value={histEnd}
                onChange={(e) => setHistEnd(e.target.value)}
                className="w-full border rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <label className="text-xs text-slate-600 w-16">Search</label>
              <input
                type="search"
                value={histQuery}
                onChange={(e) => setHistQuery(e.target.value)}
                placeholder="location, time, earnings…"
                className="w-full border rounded px-2 py-1 text-sm"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="text-sm px-3 py-1 border rounded bg-slate-800 text-white hover:bg-slate-700"
            >
              {historyLoading ? "Loading…" : "Apply Filters"}
            </button>
            <button
              type="button"
              onClick={() => {
                setHistStart("");
                setHistEnd("");
                setHistQuery("");
                void loadHistory();
              }}
              className="text-sm px-3 py-1 border rounded bg-white hover:bg-gray-100"
            >
              Clear
            </button>
          </div>

          <div className="max-h-64 overflow-auto border rounded">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-2 py-2">Clock In</th>
                  <th className="text-left px-2 py-2">Clock Out</th>
                  <th className="text-left px-2 py-2">Location</th>
                  <th className="text-right px-2 py-2">Rate</th>
                  <th className="text-right px-2 py-2">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-2 py-3 text-center text-slate-500">
                      {historyLoading ? "Loading…" : "No entries"}
                    </td>
                  </tr>
                ) : (
                  historyRows.map((r) => {
                    const rate = r.hourly_rate_cents ?? null;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-2 py-2">{r.clock_in ? new Date(r.clock_in).toLocaleString() : "—"}</td>
                        <td className="px-2 py-2">{r.clock_out ? new Date(r.clock_out).toLocaleString() : "—"}</td>
                        <td className="px-2 py-2">
                          {isCoord(r.location ?? null) ? (
                            <a
                              href={coordLink(r.location as string)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                              title="Open in Google Maps"
                            >
                              {r.location}
                            </a>
                          ) : (
                            r.location ?? "—"
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">{rate != null ? formatCurrencyCents(rate) + "/hr" : "—"}</td>
                        <td className="px-2 py-2 text-right">{r.earnings != null ? `$${Number(r.earnings).toFixed(2)}` : "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      {status === "working" && (
  <div className="mb-3 flex items-center justify-between text-sm">
    <div className="text-slate-700 font-mono">⏱ {elapsedLabel}</div>
    <div className="text-slate-700">
      {currentRateCents != null && (
        <span className="mr-3">Rate: {formatCurrencyCents(currentRateCents)}/hr</span>
      )}
      {liveEarningsCents != null && (
        <span>Earned: {formatCurrencyCents(liveEarningsCents)}</span>
      )}
    </div>
  </div>
)}

      {status === "idle" ? (
        <button
          onClick={handleClockIn}
          disabled={
            loading ||
            initializing ||
            (shiftRequired && !shiftId) ||
            !canActOnShift
          }
          title={!canActOnShift ? "You are not assigned to this shift" : shiftRequired && !shiftId ? "Select a shift to clock in" : undefined}
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
