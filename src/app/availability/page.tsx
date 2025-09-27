"use client";

import RequireAuth from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Calendar, type DayShift } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  approveAvailability,
  cancelAvailability,
  createAvailability,
  denyAvailability,
  fetchAvailability,
  fetchMyAvailability,
  type Availability,
  type AvailabilityStatus,
} from "@/features/availability/api";
import { createShift } from "@/features/shifts/api";
import { fetchUnits, type Unit } from "@/features/units/api";
import { fetchUsers, type User } from "@/features/users/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

const STATUS_COLORS: Record<AvailabilityStatus, string> = {
  proposed: "#f59e0b",
  approved: "#16a34a",
  denied: "#ef4444",
  cancelled: "#94a3b8",
};

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}
function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function formatDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function parseLocal(dateString: string): Date {
  return new Date(dateString);
}
function addHours(date: Date, hours: number): Date {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
}
function toISO(date: Date): string {
  return date.toISOString();
}
function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hasDate(list: Date[], date: Date): boolean {
  return list.some((item) => sameDay(item, date));
}

const TEMPLATE_OPTIONS = [
  { value: "", label: "(none)" },
  { value: "07-19", label: "07:00 – 19:00" },
  { value: "19-07", label: "19:00 – 07:00" },
  { value: "10-19", label: "10:00 – 19:00" },
  { value: "19-06", label: "19:00 – 06:00" },
  { value: "12h", label: "12 hours (from next quarter)" },
  { value: "24h", label: "24 hours (full day)" },
];

function applyTemplate(template: string, baseDate: Date): { start: string; end: string; durationHours: number } | null {
  if (!template) return null;
  const base = new Date(baseDate);
  base.setSeconds(0, 0);

  const match = /^(\d{2})-(\d{2})$/.exec(template);
  if (match) {
    const startHour = parseInt(match[1], 10);
    const endHour = parseInt(match[2], 10);
    const startDate = new Date(base);
    startDate.setHours(startHour, 0, 0, 0);
    const endDate = new Date(base);
    endDate.setHours(endHour, 0, 0, 0);
    if (endHour <= startHour) endDate.setDate(endDate.getDate() + 1);
    const durationHours = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 36e5));
    return { start: formatDateTimeLocal(startDate), end: formatDateTimeLocal(endDate), durationHours };
  }

  if (template === "12h") {
    const startDate = addHours(roundToQuarter(baseDate), 0);
    const endDate = addHours(startDate, 12);
    return { start: formatDateTimeLocal(startDate), end: formatDateTimeLocal(endDate), durationHours: 12 };
  }

  if (template === "24h") {
    const startDate = startOfDay(baseDate);
    const endDate = addHours(startDate, 24);
    return { start: formatDateTimeLocal(startDate), end: formatDateTimeLocal(endDate), durationHours: 24 };
  }

  return null;
}

function roundToQuarter(date: Date): Date {
  const d = new Date(date);
  const minutes = d.getMinutes();
  const next = Math.ceil(minutes / 15) * 15;
  d.setMinutes(next === 60 ? 0 : next, 0, 0);
  if (next === 60) d.setHours(d.getHours() + 1);
  return d;
}

function getStatusLabel(status: AvailabilityStatus): string {
  switch (status) {
    case "proposed":
      return "Proposed";
    case "approved":
      return "Approved";
    case "denied":
      return "Denied";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function formatTimeRange(startISO: string, endISO: string): string {
  const start = new Date(startISO);
  const end = new Date(endISO);
  const format = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (start.toDateString() === end.toDateString()) {
    return `${format(start)} – ${format(end)}`;
  }
  return `${start.toLocaleString()} – ${end.toLocaleString()}`;
}

function extractUserName(user?: User | null): string | undefined {
  if (!user) return undefined;
  if (user.name && user.name.trim()) return user.name;
  if (user.email) return user.email;
  if (user.employee_id) return user.employee_id;
  return undefined;
}

export default function AvailabilityPage() {
  const queryClient = useQueryClient();

  type MeState = {
    id?: string;
    role?: string;
    email?: string;
    name?: string;
    tenant_id?: string;
  };

  const [me, setMe] = React.useState<MeState | null>(null);
  const [authRole, setAuthRole] = React.useState<string>("member");
  const [loadingMe, setLoadingMe] = React.useState(true);
  const [tenantId, setTenantId] = React.useState("");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    try {
      const storedTenant = typeof window !== "undefined" ? localStorage.getItem("tenant_id") : null;
      if (storedTenant) {
        setTenantId(storedTenant);
      }
    } catch (err) {
      console.warn("Failed to restore tenant id", err);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function loadMe() {
      try {
        const base =
          (process.env.NEXT_PUBLIC_API_URL ||
            process.env.NEXT_PUBLIC_API_BASE ||
            process.env.NEXT_PUBLIC_API_BASE_URL ||
            "").replace(/\/+$/, "");
        const url = base ? `${base}/auth/me` : "/auth/me";
        const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(url, { credentials: "include", headers });
        if (!res.ok) throw new Error("Failed to load profile");
        const data = await res.json();
        if (cancelled) return;
        const next: MeState = {
          id: data?.id ?? data?.user?.id ?? data?.user_id,
          role: String(data?.role ?? data?.user?.role ?? "member").toLowerCase(),
          email: data?.email ?? data?.user?.email,
          name: data?.name ?? data?.user?.name,
          tenant_id: data?.tenant_id ?? data?.user?.tenant_id,
        };
        setMe(next);
        setAuthRole(next.role ?? "member");
        if (!tenantId && next.tenant_id) {
          setTenantId(next.tenant_id);
        }
      } catch (err) {
        console.warn(err);
      } finally {
        if (!cancelled) setLoadingMe(false);
      }
    }
    loadMe();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const isAdmin = authRole === "admin";

  const [viewMonth, setViewMonth] = React.useState<Date>(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(startOfDay(new Date()));
  const [selectedDates, setSelectedDates] = React.useState<Date[]>(() => [startOfDay(new Date())]);
  const [multiDayMode, setMultiDayMode] = React.useState(false);
  const [template, setTemplate] = React.useState<string>("");
  const [durationHrs, setDurationHrs] = React.useState<number>(4);

  const windowStart = React.useMemo(() => {
    const start = startOfMonth(viewMonth);
    const buffer = new Date(start);
    buffer.setDate(buffer.getDate() - 7);
    return buffer;
  }, [viewMonth]);
  const windowEnd = React.useMemo(() => {
    const end = endOfMonth(viewMonth);
    const buffer = new Date(end);
    buffer.setDate(buffer.getDate() + 7);
    buffer.setHours(23, 59, 59, 999);
    return buffer;
  }, [viewMonth]);

  const monthKey = `${viewMonth.getFullYear()}-${viewMonth.getMonth() + 1}`;

  const { data: users } = useQuery<User[]>({
    queryKey: ["tenant-users", tenantId],
    queryFn: () => fetchUsers(tenantId),
    enabled: isAdmin && !!tenantId,
  });

  const usersById = React.useMemo(() => {
    const map: Record<string, User> = {};
    (users ?? []).forEach((user) => {
      if (user.id) map[user.id] = user;
    });
    return map;
  }, [users]);

  const unitsQuery = useQuery<Unit[]>({
    queryKey: ["units", tenantId],
    queryFn: () => fetchUnits(tenantId),
    enabled: isAdmin && !!tenantId,
  });

  const availabilityQuery = useQuery<Availability[]>({
    queryKey: ["availability", tenantId, monthKey, isAdmin ? "all" : "mine"],
    queryFn: () =>
      isAdmin
        ? fetchAvailability(tenantId, {
            start: toISO(windowStart),
            end: toISO(windowEnd),
          })
        : fetchMyAvailability(tenantId || undefined),
    enabled: !!tenantId && !loadingMe,
  });

  const myAvailabilityQuery = useQuery<Availability[]>({
    queryKey: ["availability", "mine", tenantId],
    queryFn: () => fetchMyAvailability(tenantId || undefined),
    enabled: !!tenantId && !loadingMe,
  });

  const availabilities = availabilityQuery.data ?? [];
  const myAvailabilities = myAvailabilityQuery.data ?? [];
  const units = unitsQuery.data ?? [];
  const defaultUnitId = units.length > 0 ? units[0].id : "";

  const [unitSelections, setUnitSelections] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!isAdmin) return;
    setUnitSelections((curr) => {
      const next = { ...curr };
      let changed = false;
      availabilities.forEach((item) => {
        if (!next[item.id]) {
          next[item.id] = defaultUnitId;
          changed = true;
        }
      });
      return changed ? next : curr;
    });
  }, [availabilities, defaultUnitId, isAdmin]);

  const calendarSource = isAdmin ? availabilities : myAvailabilities;

  const shiftsByDate = React.useMemo(() => {
    const map: Record<string, DayShift[]> = {};
    calendarSource.forEach((item) => {
      const dateKey = ymd(new Date(item.start_ts));
      const list = map[dateKey] ?? (map[dateKey] = []);
      const userName = extractUserName(usersById[item.user_id]) ?? (isAdmin ? item.user_id : me?.name ?? me?.email ?? "Me");
      list.push({
        id: item.id,
        userName,
        unitName: getStatusLabel(item.status),
        start: item.start_ts,
        end: item.end_ts,
        color: STATUS_COLORS[item.status],
        status: item.status,
      });
    });
    return map;
  }, [calendarSource, usersById, isAdmin, me]);

  const [formStart, setFormStart] = React.useState<string>(() => formatDateTimeLocal(addHours(new Date(), 1)));
  const [formEnd, setFormEnd] = React.useState<string>(() => formatDateTimeLocal(addHours(new Date(), 2)));
  const [formNotes, setFormNotes] = React.useState("");
  const [formMsg, setFormMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!multiDayMode && selectedDate) {
      const singular = startOfDay(selectedDate);
      if (!(selectedDates.length === 1 && sameDay(selectedDates[0], singular))) {
        setSelectedDates([singular]);
      }
    }
  }, [multiDayMode, selectedDate, selectedDates]);

  React.useEffect(() => {
    if (!template || !selectedDate) return;
    const applied = applyTemplate(template, selectedDate);
    if (applied) {
      setFormStart(applied.start);
      setFormEnd(applied.end);
      setDurationHrs(applied.durationHours);
    }
  }, [template, selectedDate]);

  React.useEffect(() => {
    const start = parseLocal(formStart);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start);
    end.setHours(end.getHours() + durationHrs);
    setFormEnd(formatDateTimeLocal(end));
  }, [durationHrs]);

  React.useEffect(() => {
    const start = parseLocal(formStart);
    const end = parseLocal(formEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    const diff = (end.getTime() - start.getTime()) / 36e5;
    if (diff > 0 && Math.round(diff) !== durationHrs) {
      setDurationHrs(Math.max(1, Math.round(diff)));
    }
  }, [formEnd, formStart, durationHrs]);

  React.useEffect(() => {
    if (selectedDate) {
      const start = new Date(selectedDate);
      start.setHours(9, 0, 0, 0);
      const end = addHours(start, 4);
      setFormStart(formatDateTimeLocal(start));
      setFormEnd(formatDateTimeLocal(end));
    }
  }, []);

  const handleSelect = React.useCallback(
    (day: Date | null) => {
      if (!day) return;
      const normalized = startOfDay(day);
      setSelectedDate(normalized);

      if (multiDayMode) {
        setSelectedDates((prev) => {
          const exists = hasDate(prev, normalized);
          if (exists) {
            const next = prev.filter((d) => !sameDay(d, normalized));
            return next.length > 0 ? next : [normalized];
          }
          return [...prev, normalized].sort((a, b) => a.getTime() - b.getTime());
        });
      } else {
        setSelectedDates([normalized]);
      }

      if (template) {
        const applied = applyTemplate(template, normalized);
        if (applied) {
          setFormStart(applied.start);
          setFormEnd(applied.end);
          setDurationHrs(applied.durationHours);
          return;
        }
      }

      const startReference = parseLocal(formStart);
      const endReference = parseLocal(formEnd);

      const startDate = new Date(normalized);
      if (!Number.isNaN(startReference.getTime())) {
        startDate.setHours(startReference.getHours(), startReference.getMinutes(), 0, 0);
      } else {
        startDate.setHours(9, 0, 0, 0);
      }

      const endDate = new Date(startDate);
      if (!Number.isNaN(endReference.getTime())) {
        endDate.setHours(endReference.getHours(), endReference.getMinutes(), 0, 0);
        if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
        const diff = (endDate.getTime() - startDate.getTime()) / 36e5;
        if (diff > 0 && Math.round(diff) !== durationHrs) {
          setDurationHrs(Math.max(1, Math.round(diff)));
        }
      } else {
        endDate.setHours(endDate.getHours() + durationHrs);
      }

      setFormStart(formatDateTimeLocal(startDate));
      setFormEnd(formatDateTimeLocal(endDate));
    },
    [multiDayMode, template, formStart, formEnd, durationHrs]
  );

  const selectedDayAvailabilities = React.useMemo(() => {
    if (!selectedDate) return [] as Availability[];
    return calendarSource.filter((item) => sameDay(new Date(item.start_ts), selectedDate));
  }, [calendarSource, selectedDate]);

  const proposedAvailabilities = React.useMemo(() => {
    if (!isAdmin) return [] as Availability[];
    return [...availabilities]
      .filter((item) => String(item.status || "").toLowerCase() === "proposed")
      .sort((a, b) => {
      return new Date(a.start_ts).getTime() - new Date(b.start_ts).getTime();
    });
  }, [availabilities, isAdmin]);

  function saveTenant(next: string) {
    setTenantId(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("tenant_id", next);
    }
    queryClient.invalidateQueries({ queryKey: ["availability"] });
  }

  const createMut = useMutation({
    mutationFn: async () => {
      if (!tenantId) {
        throw new Error("Set a tenant first");
      }
      const startTemplate = parseLocal(formStart);
      const endTemplate = parseLocal(formEnd);
      if (Number.isNaN(startTemplate.getTime()) || Number.isNaN(endTemplate.getTime())) {
        throw new Error("Select valid start and end times");
      }
      if (endTemplate <= startTemplate) {
        throw new Error("End time must be after start time");
      }

      const targets = multiDayMode && selectedDates.length > 0
        ? selectedDates
        : selectedDate
        ? [selectedDate]
        : [startTemplate];

      const payloads = targets.map((target) => {
        const baseDay = new Date(target);
        const start = new Date(baseDay);
        start.setHours(startTemplate.getHours(), startTemplate.getMinutes(), 0, 0);
        const end = new Date(baseDay);
        end.setHours(endTemplate.getHours(), endTemplate.getMinutes(), 0, 0);
        if (end <= start) {
          end.setDate(end.getDate() + 1);
        }
        return createAvailability(tenantId, {
          start_ts: toISO(start),
          end_ts: toISO(end),
          notes: formNotes.trim() ? formNotes.trim() : undefined,
        });
      });

      await Promise.all(payloads);
      return payloads.length;
    },
    onSuccess: (count) => {
      setFormMsg(count > 1 ? `Submitted ${count} availability slots` : "Availability submitted");
      queryClient.invalidateQueries({ queryKey: ["availability", tenantId, monthKey, "all"] });
      queryClient.invalidateQueries({ queryKey: ["availability", tenantId, monthKey, "mine"] });
      queryClient.invalidateQueries({ queryKey: ["availability", "mine", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["availability"] });
      setTimeout(() => setFormMsg(null), 3000);
    },
    onError: (err: unknown) => {
      setFormMsg((err as Error)?.message ?? "Failed to submit availability");
    },
  });

  const approveMut = useMutation({
    mutationFn: async (args: { availability: Availability; unitId: string }) => {
      if (!tenantId) throw new Error("Set a tenant first");
      const { availability, unitId } = args;
      if (!unitId) throw new Error("Select a unit before approving");
      await approveAvailability(tenantId, availability.id);
      await createShift(tenantId, {
        unit_id: unitId,
        user_id: availability.user_id,
        start_time: availability.start_ts,
        end_time: availability.end_ts,
        notes: availability.notes ? `Availability approved: ${availability.notes}` : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability", tenantId, monthKey, "all"] });
      queryClient.invalidateQueries({ queryKey: ["availability", "mine", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
    onError: (err: unknown) => {
      setFormMsg((err as Error)?.message ?? "Failed to approve availability");
      setTimeout(() => setFormMsg(null), 4000);
    },
  });

  const denyMut = useMutation({
    mutationFn: (availabilityId: string) => denyAvailability(tenantId, availabilityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability", tenantId, monthKey, "all"] });
      queryClient.invalidateQueries({ queryKey: ["availability", "mine", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  const cancelMut = useMutation({
    mutationFn: (availabilityId: string) => cancelAvailability(tenantId, availabilityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability", tenantId, monthKey, "all"] });
      queryClient.invalidateQueries({ queryKey: ["availability", "mine", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["availability"] });
    },
  });

  if (!mounted) return <div />;

  return (
    <RequireAuth>
      <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Availability</h1>
          <p className="text-sm text-muted-foreground">
            Submit availability slots for scheduling and track their approval status.
          </p>
        </div>

        <Card className="p-4 space-y-3">
          <div className="text-sm font-medium">Tenant ID</div>
          <div className="flex flex-wrap gap-2">
            <Input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="Tenant UUID"
            />
            <Button type="button" onClick={() => saveTenant(tenantId)}>
              Save
            </Button>
          </div>
          {!tenantId && (
            <div className="text-xs text-amber-600">
              Set a tenant to load availability data.
            </div>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card className="p-4">
            <Calendar
              month={viewMonth}
              onMonthChange={(next) => setViewMonth(startOfMonth(next))}
              selectedDate={selectedDate ?? undefined}
              selectedDates={selectedDates}
              onSelect={handleSelect}
              shiftsByDate={shiftsByDate}
              loading={availabilityQuery.isLoading}
            />
          </Card>

          <div className="space-y-6">
            {!isAdmin ? (
              <Card className="p-4 space-y-3">
              <div className="text-sm font-semibold">Selected day</div>
              <div className="text-sm text-muted-foreground">
                {selectedDate ? selectedDate.toLocaleDateString(undefined, { dateStyle: "full" }) : "Pick a day"}
              </div>
              {!isAdmin ? (
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={multiDayMode}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setMultiDayMode(enabled);
                        if (!enabled && selectedDate) {
                          setSelectedDates([startOfDay(selectedDate)]);
                        }
                      }}
                    />
                    Multi-day select
                  </label>
                  <span>{selectedDates.length} day(s) selected</span>
                  {multiDayMode && selectedDates.length > 0 ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        setSelectedDates([]);
                        setSelectedDate(null);
                      }}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              ) : null}
              {isAdmin && units.length === 0 ? (
                <div className="text-xs text-amber-600">
                  No units found for this tenant. Create a unit before approving availability.
                </div>
              ) : null}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {selectedDayAvailabilities.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No availability for this day yet.</div>
                ) : (
                  selectedDayAvailabilities.map((item) => {
                    const isMine = myAvailabilities.some((mine) => mine.id === item.id);
                    const userName = extractUserName(usersById[item.user_id]) ?? (isMine ? "You" : item.user_id);
                    const approveVariables = approveMut.variables as { availability?: Availability } | undefined;
                    const isApproveBusy = approveMut.isPending && approveVariables?.availability?.id === item.id;
                    const busy = approveMut.isPending || denyMut.isPending || cancelMut.isPending;
                    const selectedUnitId = unitSelections[item.id] || defaultUnitId;
                    const accent = STATUS_COLORS[item.status];
                    const bgTint = `${accent}1A`;
                    const borderTint = `${accent}66`;
                    return (
                      <Card
                        key={item.id}
                        className="p-3 border"
                        style={{
                          borderColor: borderTint,
                          background: bgTint,
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{userName}</span>
                          <span className="text-xs" style={{ color: STATUS_COLORS[item.status] }}>
                            {getStatusLabel(item.status)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatTimeRange(item.start_ts, item.end_ts)}
                        </div>
                        {isAdmin ? (
                          <div className="mt-2">
                            <label className="text-xs font-medium">
                              Assign unit
                              <select
                                value={selectedUnitId}
                                onChange={(e) =>
                                  setUnitSelections((prev) => ({ ...prev, [item.id]: e.target.value }))
                                }
                                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                disabled={units.length === 0}
                              >
                                {units.length === 0 ? (
                                  <option value="">No units available</option>
                                ) : (
                                  units.map((unit) => (
                                    <option key={unit.id} value={unit.id}>
                                      {unit.name}
                                    </option>
                                  ))
                                )}
                              </select>
                            </label>
                          </div>
                        ) : null}
                        {item.notes ? (
                          <div className="text-xs mt-2 bg-muted/40 rounded p-2">{item.notes}</div>
                        ) : null}
                        <div className="flex flex-wrap gap-2 mt-3">
                          {isMine && item.status !== "cancelled" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => cancelMut.mutate(item.id)}
                              disabled={cancelMut.isPending || item.status === "denied"}
                            >
                              {cancelMut.isPending && cancelMut.variables === item.id ? "Cancelling…" : "Cancel"}
                            </Button>
                          ) : null}
                          {isAdmin && item.status !== "approved" ? (
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                const unitId = unitSelections[item.id] || defaultUnitId;
                                if (!unitId) {
                                  alert("Select a unit before approving");
                                  return;
                                }
                                approveMut.mutate({ availability: item, unitId });
                              }}
                          disabled={busy || units.length === 0}
                        >
                              {isApproveBusy ? "Approving…" : "Approve"}
                            </Button>
                          ) : null}
                          {isAdmin && item.status !== "denied" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => denyMut.mutate(item.id)}
                              disabled={busy}
                            >
                              {denyMut.isPending && denyMut.variables === item.id ? "Denying…" : "Deny"}
                            </Button>
                          ) : null}
                        </div>
                      </Card>
                    );
                  })
                )}
              </div>
            </Card>

            {isAdmin ? (
              <Card className="p-4 space-y-3">
                <div className="text-sm font-semibold">Pending availability</div>
                <div className="text-xs text-muted-foreground">
                  Review proposed slots from team members and approve them into the schedule.
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {proposedAvailabilities.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No proposed availability at the moment.</div>
                  ) : (
                    proposedAvailabilities.map((item) => {
                      const userName = extractUserName(usersById[item.user_id]) ?? item.user_id;
                      const selectedUnitId = unitSelections[item.id] || defaultUnitId;
                      const isApproveBusy = approveMut.isPending && (approveMut.variables as { availability?: Availability } | undefined)?.availability?.id === item.id;
                      const busy = approveMut.isPending || denyMut.isPending || cancelMut.isPending;
                      const accent = STATUS_COLORS[item.status];
                      const bgTint = `${accent}1A`;
                      const borderTint = `${accent}66`;
                      return (
                        <Card
                          key={`pending-${item.id}`}
                          className="p-3 border"
                          style={{ borderColor: borderTint, background: bgTint }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{userName}</span>
                            <span className="text-xs" style={{ color: STATUS_COLORS[item.status] }}>Proposed</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(item.start_ts).toLocaleString()} → {new Date(item.end_ts).toLocaleString()}
                          </div>
                          <div className="mt-2">
                            <label className="text-xs font-medium">
                              Assign unit
                              <select
                                value={selectedUnitId}
                                onChange={(e) => setUnitSelections((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                disabled={units.length === 0}
                              >
                                {units.length === 0 ? (
                                  <option value="">No units available</option>
                                ) : (
                                  units.map((unit) => (
                                    <option key={unit.id} value={unit.id}>
                                      {unit.name}
                                    </option>
                                  ))
                                )}
                              </select>
                            </label>
                          </div>
                          {item.notes ? (
                            <div className="text-xs mt-2 bg-muted/40 rounded p-2">{item.notes}</div>
                          ) : null}
                          <div className="flex flex-wrap gap-2 mt-3">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                const unitId = unitSelections[item.id] || defaultUnitId;
                                if (!unitId) {
                                  alert("Select a unit before approving");
                                  return;
                                }
                                approveMut.mutate({ availability: item, unitId });
                              }}
                              disabled={busy || units.length === 0}
                            >
                              {isApproveBusy ? "Approving…" : "Approve"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => denyMut.mutate(item.id)}
                              disabled={busy}
                            >
                              {denyMut.isPending && denyMut.variables === item.id ? "Denying…" : "Deny"}
                            </Button>
                          </div>
                        </Card>
                      );
                    })
                  )}
                </div>
              </Card>
            ) : null}

            <Card className="p-4 space-y-3">
              <div className="text-sm font-semibold">Submit availability</div>
              <div className="text-xs text-muted-foreground">
                Pick a date and specify your preferred time window. Slots start as <strong>Proposed</strong> until an administrator reviews them.
              </div>
              <div className="space-y-3">
                <label className="text-sm font-medium flex flex-col gap-1">
                  Start
                  <Input
                    type="datetime-local"
                    value={formStart}
                    onChange={(e) => {
                      setTemplate("");
                      setFormStart(e.target.value);
                    }}
                    min="1970-01-01T00:00"
                  />
                </label>
                <label className="text-sm font-medium flex flex-col gap-1">
                  End
                  <Input
                    type="datetime-local"
                    value={formEnd}
                    onChange={(e) => {
                      setTemplate("");
                      setFormEnd(e.target.value);
                    }}
                    min={formStart}
                  />
                </label>
                <label className="text-sm font-medium flex flex-col gap-1">
                  Template (optional)
                  <select
                    value={template}
                    onChange={(e) => {
                      const val = e.target.value;
                      setTemplate(val);
                      if (!val) return;
                      const reference = selectedDate ?? new Date();
                      const applied = applyTemplate(val, reference);
                      if (applied) {
                        setFormStart(applied.start);
                        setFormEnd(applied.end);
                        setDurationHrs(applied.durationHours);
                      }
                    }}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {TEMPLATE_OPTIONS.map((opt) => (
                      <option key={opt.value || "_none"} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium flex flex-col gap-1">
                  Duration (hours)
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    value={durationHrs}
                    onChange={(e) => {
                      setTemplate("");
                      const val = Number(e.target.value || 1);
                      setDurationHrs(Math.max(1, Math.min(24, Math.round(val))));
                    }}
                  />
                </label>
                <label className="text-sm font-medium flex flex-col gap-1">
                  Notes (optional)
                  <textarea
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="Any additional details"
                  />
                </label>
                {formMsg ? (
                  <div className="text-xs" style={{ color: formMsg.toLowerCase().includes("failed") ? "#dc2626" : "#16a34a" }}>
                    {formMsg}
                  </div>
                ) : null}
                <Button
                  type="button"
                  onClick={() => {
                    if (!tenantId) {
                      alert("Set a tenant first");
                      return;
                    }
                    createMut.mutate();
                  }}
                  disabled={createMut.isPending || !tenantId}
                >
                  {createMut.isPending ? "Submitting…" : "Submit availability"}
                </Button>
                {multiDayMode && selectedDates.length > 0 ? (
                  <div className="text-xs text-muted-foreground">
                    Multi-day mode will create one slot per selected day using the start/end times above.
                  </div>
                ) : null}
              </div>
              </Card>
            ) : (
              <Card className="p-4 space-y-2">
                <div className="text-sm font-semibold">Availability review</div>
                <div className="text-xs text-muted-foreground">
                  Members submit their availability here. Approve proposed slots below to place them on the schedule.
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
