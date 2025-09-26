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

  const selectedDayAvailabilities = React.useMemo(() => {
    if (!selectedDate) return [] as Availability[];
    return calendarSource.filter((item) => sameDay(new Date(item.start_ts), selectedDate));
  }, [calendarSource, selectedDate]);

  const [formStart, setFormStart] = React.useState<string>(() => formatDateTimeLocal(addHours(new Date(), 1)));
  const [formEnd, setFormEnd] = React.useState<string>(() => formatDateTimeLocal(addHours(new Date(), 2)));
  const [formNotes, setFormNotes] = React.useState("");
  const [formMsg, setFormMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (selectedDate) {
      const start = new Date(selectedDate);
      start.setHours(9, 0, 0, 0);
      const end = addHours(start, 4);
      setFormStart(formatDateTimeLocal(start));
      setFormEnd(formatDateTimeLocal(end));
    }
  }, [selectedDate]);

  function saveTenant(next: string) {
    setTenantId(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("tenant_id", next);
    }
    queryClient.invalidateQueries({ queryKey: ["availability"] });
  }

  const createMut = useMutation({
    mutationFn: async () => {
      const start = parseLocal(formStart);
      const end = parseLocal(formEnd);
      if (end <= start) {
        throw new Error("End time must be after start time");
      }
      return createAvailability(tenantId, {
        start_ts: toISO(start),
        end_ts: toISO(end),
        notes: formNotes.trim() ? formNotes.trim() : undefined,
      });
    },
    onSuccess: () => {
      setFormMsg("Availability submitted");
      queryClient.invalidateQueries({ queryKey: ["availability", tenantId, monthKey, isAdmin ? "all" : "mine"] });
      queryClient.invalidateQueries({ queryKey: ["availability", "mine", tenantId] });
      setTimeout(() => setFormMsg(null), 3000);
    },
    onError: (err: unknown) => {
      setFormMsg((err as Error)?.message ?? "Failed to submit availability");
    },
  });

  const approveMut = useMutation({
    mutationFn: (availabilityId: string) => approveAvailability(tenantId, availabilityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability", tenantId, monthKey, "all"] });
      queryClient.invalidateQueries({ queryKey: ["availability", "mine", tenantId] });
    },
  });

  const denyMut = useMutation({
    mutationFn: (availabilityId: string) => denyAvailability(tenantId, availabilityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability", tenantId, monthKey, "all"] });
      queryClient.invalidateQueries({ queryKey: ["availability", "mine", tenantId] });
    },
  });

  const cancelMut = useMutation({
    mutationFn: (availabilityId: string) => cancelAvailability(tenantId, availabilityId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability", tenantId, monthKey, "all"] });
      queryClient.invalidateQueries({ queryKey: ["availability", "mine", tenantId] });
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
              onSelect={(date) => setSelectedDate(date)}
              shiftsByDate={shiftsByDate}
              loading={availabilityQuery.isLoading}
            />
          </Card>

          <div className="space-y-6">
            <Card className="p-4 space-y-3">
              <div className="text-sm font-semibold">Selected day</div>
              <div className="text-sm text-muted-foreground">
                {selectedDate ? selectedDate.toLocaleDateString(undefined, { dateStyle: "full" }) : "Pick a day"}
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {selectedDayAvailabilities.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No availability for this day yet.</div>
                ) : (
                  selectedDayAvailabilities.map((item) => {
                    const isMine = myAvailabilities.some((mine) => mine.id === item.id);
                    const userName = extractUserName(usersById[item.user_id]) ?? (isMine ? "You" : item.user_id);
                    const busy = approveMut.isPending || denyMut.isPending || cancelMut.isPending;
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
                              onClick={() => approveMut.mutate(item.id)}
                              disabled={busy}
                            >
                              {approveMut.isPending && approveMut.variables === item.id ? "Approving…" : "Approve"}
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
                    onChange={(e) => setFormStart(e.target.value)}
                    min="1970-01-01T00:00"
                  />
                </label>
                <label className="text-sm font-medium flex flex-col gap-1">
                  End
                  <Input
                    type="datetime-local"
                    value={formEnd}
                    onChange={(e) => setFormEnd(e.target.value)}
                    min={formStart}
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
              </div>
            </Card>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
