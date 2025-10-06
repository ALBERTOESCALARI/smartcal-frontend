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
  const [serverRateCents, setServerRateCents] = useState<number | null>(null);
  const [overrideLocked, setOverrideLocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("rate_override_locked") === "true"; } catch { return false; }
  });

  // Rate editor state
  const [showRateEditor, setShowRateEditor] = useState(false);
  const [rateInput, setRateInput] = useState<string>("");
  const [savingRate, setSavingRate] = useState(false);

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
  const [histStartDate, setHistStartDate] = useState<string>("");
  const [histStartTime, setHistStartTime] = useState<string>("");
  const [histEndDate, setHistEndDate] = useState<string>("");
  const [histEndTime, setHistEndTime] = useState<string>("");
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

// Fallback: load user default rate if clock status didn't include one
const loadUserRateFallback = useCallback(async () => {
  try {
    // try /auth/me first, then /users/me
    let data: any = null;
    try {
      data = (await api.get("/auth/me")).data;
    } catch {
      try {
        data = (await api.get("/users/me")).data;
      } catch {
        data = null;
      }
    }
    if (!data) return;
    // support both cents and dollars fields
    let cents: number | null = null;
    if (data.hourly_rate_cents != null) cents = Number(data.hourly_rate_cents);
    else if (data.hourly_rate != null) cents = Math.round(Number(data.hourly_rate) * 100);
    if (Number.isFinite(cents)) {
      setRateCentsFromApi(cents as number);
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem("hourly_rate_cents", String(cents));
        }
      } catch { /* ignore */ }
    }
  } catch {
    // silent fallback
  }
}, []);

// Combine date ('YYYY-MM-DD') and time ('HH:mm') into ISO string in local time
const toIsoFromDateTime = (d?: string, t?: string): string | null => {
  if (!d) return null;
  const time = t && /^\d{2}:\d{2}$/.test(t) ? t : "00:00";
  const dt = new Date(`${d}T${time}`);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
};
// Quick helpers to set today/now
const setTodayStart = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  setHistStartDate(`${yyyy}-${mm}-${dd}`);
  setHistStartTime("00:00");
};
const setTodayEnd = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  setHistEndDate(`${yyyy}-${mm}-${dd}`);
  setHistEndTime("23:59");
};

// Try to find an hourly rate (in cents) from common places.
// If you later pass a rate via props, swap this out.
const currentRateCents = useMemo(() => {
  // 1) Prefer a local override (set when user edits rate)
  if (typeof window !== "undefined") {
    const raw = window.localStorage?.getItem("hourly_rate_cents_override");
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // 2) Prefer rate from API clock status if available
  if (rateCentsFromApi != null && Number.isFinite(Number(rateCentsFromApi))) {
    return Number(rateCentsFromApi);
  }
  if (typeof window === "undefined") return null;
  // 3) Fallback sources in app shell / storage
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
    setServerRateCents(
      apiRate != null && Number.isFinite(Number(apiRate)) ? Number(apiRate) : null
    );
    setRateCentsFromApi(
      apiRate != null && Number.isFinite(Number(apiRate)) ? Number(apiRate) : null
    );
    // If server provided a rate, clear local override so we trust backend (unless locked)
    try {
      if (apiRate != null && typeof window !== "undefined") {
        const locked = window.localStorage.getItem("rate_override_locked") === "true";
        if (!locked) {
          window.localStorage.removeItem("hourly_rate_cents_override");
        }
      }
    } catch { /* ignore */ }
    // Persist server rate as baseline fallback
    try {
      if (apiRate != null && typeof window !== "undefined") {
        window.localStorage.setItem("hourly_rate_cents", String(Number(apiRate)));
      }
    } catch { /* ignore */ }

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
      const startIso = toIsoFromDateTime(histStartDate, histStartTime);
      const endIso = toIsoFromDateTime(histEndDate, histEndTime);
      if (startIso) params.start = startIso;
      if (endIso) params.end = endIso;

      const { data } = await api.get<HistoryRow[]>("/time/me", { params });

      // Fill in missing earnings on the client
      const withComputed = data.map((r) => {
        // Leave existing earnings intact if backend provided them
        if (r.earnings != null) return r;

        // Pick a rate (cents): row-specific -> server -> current
        const rateCentsCandidate =
          (typeof r.hourly_rate_cents === "number" && Number.isFinite(r.hourly_rate_cents) && r.hourly_rate_cents > 0
            ? r.hourly_rate_cents
            : (serverRateCents ?? currentRateCents ?? null));

        if (!rateCentsCandidate || !r.clock_in) return r;

        const startMs = new Date(r.clock_in).getTime();
        const endMs = r.clock_out ? new Date(r.clock_out).getTime() : Date.now();

        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return r;

        // Compute cents, store dollars
        const cents = earningsFromElapsedMs(endMs - startMs, rateCentsCandidate);
        return { ...r, earnings: Math.round(cents) / 100 };
      });

      // optional client-side search by substring on location or timestamps
      const q = histQuery.trim().toLowerCase();
      const filtered = q
        ? withComputed.filter((r) =>
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
        : withComputed;

      setHistoryRows(filtered);
    } catch (e) {
      console.error("Failed to load history", e);
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [histStartDate, histStartTime, histEndDate, histEndTime, histQuery, serverRateCents, currentRateCents]);

  const hydrateStatus = useCallback(async () => {
    const statusResponse = await getClockStatus();
    applyClockStatus(statusResponse);
    return statusResponse;
  }, [applyClockStatus]);

  const saveRate = useCallback(async () => {
    const v = Number(rateInput);
    if (!Number.isFinite(v) || v <= 0) {
      setError((prev) => prev ?? "Enter a valid hourly rate (e.g. 22.50)");
      return;
    }
    setSavingRate(true);
    try {
      // 1) Try dedicated time/rate endpoint if present
      try {
        const res = await api.patch("/time/rate", { hourly_rate: v, apply_to_open_entry: true });
        const cents = res?.data?.hourly_rate_cents;
        if (Number.isFinite(Number(cents))) {
          setRateCentsFromApi(Number(cents));
          setShowRateEditor(false);
          try { window.localStorage.setItem("hourly_rate_cents_override", String(Math.round(v * 100))); } catch {}
          try { window.localStorage.setItem("hourly_rate_cents", String(Math.round(v * 100))); } catch {}
          return;
        }
      } catch {
        // fall through to users/me
      }
      // 2) Fallback: PATCH users/me with dollars
      try {
        const res2 = await api.patch("/users/me", { hourly_rate: v });
        const cents =
          (res2?.data && Number(res2.data.hourly_rate_cents)) ||
          Math.round(v * 100);
        if (Number.isFinite(Number(cents))) {
          setRateCentsFromApi(Number(cents));
          setShowRateEditor(false);
          try { window.localStorage.setItem("hourly_rate_cents_override", String(Math.round(v * 100))); } catch {}
          try { window.localStorage.setItem("hourly_rate_cents", String(Math.round(v * 100))); } catch {}
          return;
        }
      } catch {
        // ignore; handled by final catch
      }
      // Local fallback: no endpoint available — apply a local override so UI and live earnings update
      const centsLocal = Math.round(v * 100);
      setRateCentsFromApi(centsLocal);
      try { window.localStorage.setItem("hourly_rate_cents_override", String(centsLocal)); } catch {}
      try { window.localStorage.setItem("hourly_rate_cents", String(centsLocal)); } catch {}
      setShowRateEditor(false);
      toast({
        title: "Rate set locally",
        description: "Using a local hourly rate for this session because no backend endpoint is available.",
      });
      return;
    } catch (err) {
      const detail =
        (err as any)?.response?.data?.detail ||
        (err as any)?.message ||
        "Could not update hourly rate";
      setError(detail);
    } finally {
      setSavingRate(false);
      // refresh status so live earnings pick up any server-side changes
      try {
        await hydrateStatus();
      } catch { /* noop */ }
    }
  }, [rateInput, hydrateStatus]);

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

  // keep editor input in sync with current rate
  useEffect(() => {
    if (rateCentsFromApi != null) {
      setRateInput((rateCentsFromApi / 100).toFixed(2));
    }
  }, [rateCentsFromApi]);

  // Auto-load history when opened
  useEffect(() => {
    if (historyOpen) {
      void loadHistory();
    }
  }, [historyOpen, loadHistory]);

  // If no rate came from clock status, try to load user default
  useEffect(() => {
    if (rateCentsFromApi == null) {
      void loadUserRateFallback();
    }
  }, [rateCentsFromApi, loadUserRateFallback]);

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

      {/* Rate display / editor */}
      <div className="mb-3 flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <div className="text-slate-700">
            {currentRateCents != null ? (
              <>Effective rate: <span className="font-medium">{formatCurrencyCents(currentRateCents)}/hr</span></>
            ) : (
              <span className="text-slate-500">Rate unavailable</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!showRateEditor ? (
              <button
                type="button"
                onClick={() => setShowRateEditor(true)}
                className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-100"
                title="Edit hourly rate"
              >
                Edit rate
              </button>
            ) : (
              <>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  className="w-24 border rounded px-2 py-1 text-right font-mono"
                  placeholder="0.00"
                />
                <button
                  type="button"
                  onClick={() => void saveRate()}
                  disabled={savingRate}
                  className="px-2 py-1 text-xs rounded bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {savingRate ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowRateEditor(false); setRateInput(rateCentsFromApi != null ? (rateCentsFromApi/100).toFixed(2) : ""); }}
                  className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-100"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-600">
          <div>
            Server rate:&nbsp;
            {serverRateCents != null ? (
              <span className="font-medium">{formatCurrencyCents(serverRateCents)}/hr</span>
            ) : (
              <span className="text-slate-400">unknown</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={overrideLocked}
                onChange={(e) => {
                  const v = e.target.checked;
                  setOverrideLocked(v);
                  try {
                    if (typeof window !== "undefined") {
                      if (v) window.localStorage.setItem("rate_override_locked", "true");
                      else window.localStorage.removeItem("rate_override_locked");
                    }
                  } catch { /* ignore */ }
                }}
              />
              Keep custom rate (don’t auto-replace)
            </label>
            <button
              type="button"
              onClick={() => {
                try {
                  if (typeof window !== "undefined") {
                    window.localStorage.removeItem("hourly_rate_cents_override");
                    window.localStorage.removeItem("rate_override_locked");
                  }
                } catch { /* ignore */ }
                setOverrideLocked(false);
                // Prefer server baseline immediately if available
                if (serverRateCents != null) {
                  setRateCentsFromApi(serverRateCents);
                }
                toast({ title: "Reset to server rate" });
              }}
              className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-100"
              title="Clear custom override and use server"
            >
              Reset to server rate
            </button>
          </div>
        </div>
      </div>

      {/* Collapsible history panel */}
      {historyOpen && (
        <div
          id="history-panel"
          className="mb-3 rounded border bg-white p-3 shadow-sm"
        >
          <div className="mb-2 grid grid-cols-1 md:grid-cols-5 gap-2">
            <div className="grid grid-cols-2 items-center gap-2">
              <label className="text-xs text-slate-600 col-span-2">Start</label>
              <input
                type="date"
                value={histStartDate}
                onChange={(e) => setHistStartDate(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
              />
              <input
                type="time"
                value={histStartTime}
                onChange={(e) => setHistStartTime(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 items-center gap-2">
              <label className="text-xs text-slate-600 col-span-2">End</label>
              <input
                type="date"
                value={histEndDate}
                onChange={(e) => setHistEndDate(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
              />
              <input
                type="time"
                value={histEndTime}
                onChange={(e) => setHistEndTime(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setTodayStart(); setTodayEnd(); }}
                className="text-xs px-2 py-1 border rounded bg-white hover:bg-gray-100"
                title="Quick select: today"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => { setHistStartDate(""); setHistStartTime(""); setHistEndDate(""); setHistEndTime(""); }}
                className="text-xs px-2 py-1 border rounded bg-white hover:bg-gray-100"
                title="Clear dates"
              >
                Clear Dates
              </button>
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
                setHistStartDate("");
                setHistStartTime("");
                setHistEndDate("");
                setHistEndTime("");
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
