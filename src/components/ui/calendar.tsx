"use client";

import * as React from "react";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────
export type DayShift = {
  id: string;
  unitName?: string | null;
  userName?: string | null; // who is on shift
  start?: string | null; // ISO string
  end?: string | null;   // ISO string
  color?: string | null; // e.g., "#16a34a"
};

export type CalendarProps = {
  month: Date; // any date within the visible month
  onMonthChange?: (d: Date) => void;
  selectedDate?: Date | null;
  selectedDates?: Date[];
  onSelect?: (d: Date) => void;
  shiftsByDate?: Record<string, DayShift[]>; // key: YYYY-MM-DD
  loading?: boolean;
  printable?: boolean; // if true, renders a print‑friendly layout
  showToolbar?: boolean; // default: true
  showPrintButton?: boolean; // default: true
  className?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Date utils (no external deps)
// ──────────────────────────────────────────────────────────────────────────────
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isSameDay(a?: Date | null, b?: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Weekday labels, starting Sunday → Saturday
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ──────────────────────────────────────────────────────────────────────────────
// Calendar Component
// ──────────────────────────────────────────────────────────────────────────────
export function Calendar({
  month,
  onMonthChange,
  selectedDate,
  selectedDates,
  onSelect,
  shiftsByDate = {},
  loading = false,
  printable = false,
  showToolbar = true,
  showPrintButton = true,
  className,
}: CalendarProps) {
  const today = React.useMemo(() => startOfDay(new Date()), []);
  const visibleMonth = React.useMemo(() => startOfMonth(month), [month]);
  const endMonth = React.useMemo(() => endOfMonth(month), [month]);

  const firstWeekday = visibleMonth.getDay(); // 0 (Sun) .. 6 (Sat)
  const daysInMonth = endMonth.getDate();

  // build cells (include leading blanks for firstWeekday)
  const cells: Array<{ date: Date | null } > = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ date: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), d) });
  }
  // trailing blanks to complete 6 rows of 7 (42 cells) for consistent height
  while (cells.length % 7 !== 0) cells.push({ date: null });
  while (cells.length < 42) cells.push({ date: null });

  const monthLabel = visibleMonth.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
  });

  const inMulti = (d: Date) => Array.isArray(selectedDates) && selectedDates.some(x => isSameDay(x, d));

  function goPrevMonth() {
    const d = new Date(visibleMonth);
    d.setMonth(d.getMonth() - 1);
    onMonthChange?.(d);
  }
  function goNextMonth() {
    const d = new Date(visibleMonth);
    d.setMonth(d.getMonth() + 1);
    onMonthChange?.(d);
  }
  function goToday() {
    const t = startOfDay(new Date());
    onMonthChange?.(startOfMonth(t));
    onSelect?.(t);
  }

  return (
    <div className={"w-full " + (className ?? "")}
         data-printable={printable ? "true" : "false"}
    >
      {showToolbar && (
        <div className="flex items-center justify-between mb-2 print:hidden">
          <div className="flex items-center gap-2">
            <button
              className="border rounded-md px-2 py-1 text-sm hover:bg-muted"
              onClick={goPrevMonth}
              aria-label="Previous month"
            >
              ←
            </button>
            <button
              className="border rounded-md px-2 py-1 text-sm hover:bg-muted"
              onClick={goNextMonth}
              aria-label="Next month"
            >
              →
            </button>
            <button
              className="border rounded-md px-2 py-1 text-sm hover:bg-muted"
              onClick={goToday}
            >
              Today
            </button>
          </div>
          <div className="text-sm text-muted-foreground select-none">
            {loading ? <span>Loading…</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="font-semibold">{monthLabel}</div>
            {showPrintButton && (
              <button
                className="border rounded-md px-2 py-1 text-sm hover:bg-muted"
                onClick={() => window.print()}
              >
                Print
              </button>
            )}
          </div>
        </div>
      )}

      {/* Weekday header */}
      <div className="grid grid-cols-7 text-xs text-muted-foreground font-semibold">
        {WEEKDAYS.map((w, idx) => {
          const style = idx === 0
            ? { backgroundColor: "#dbeafe" }
            : idx === 6
            ? { backgroundColor: "#f4f4f5" }
            : undefined;
          return (
            <div
              key={`${w}-${idx}`}
              className="py-1 text-center select-none rounded-sm"
              style={style}
            >
              {w}
            </div>
          );
        })}
      </div>

      {/* Month grid */}
      <div className="grid grid-cols-7 gap-2">
        {cells.map((cell, idx) => {
          const date = cell.date;
          const columnIndex = idx % 7;
          const isSunday = columnIndex === 0;
          const isSaturday = columnIndex === 6;
          let weekendBg: string | undefined;
          if (isSunday) {
            weekendBg = "#dbeafe";
          } else if (isSaturday) {
            weekendBg = "#f4f4f5";
          } else {
            weekendBg = undefined;
          }

          if (!date) {
            return (
              <div
                key={idx}
                className="h-24 rounded-md border"
                style={weekendBg ? { backgroundColor: weekendBg } : undefined}
                aria-hidden
              />
            );
          }
          const key = ymd(date);
          const isSelected = isSameDay(date, selectedDate ?? null) || inMulti(date);
          const isToday = isSameDay(date, today);
          const dayShifts = shiftsByDate[key] || [];

          // Up to three color dots for quick visibility
          const previewDots = dayShifts.slice(0, 3).map((s, i) => (
            <span
              key={`${key}-dot-${s.id ?? i}`}
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: s.color || "#2563eb" }}
              title={(s.unitName || "") + (s.userName ? ` – ${s.userName}` : "")}
            />
          ));

          return (
            <button
              key={key}
              onClick={() => onSelect?.(startOfDay(date))}
              className={[
                "text-left px-2 py-2 border rounded-md h-24",
                "hover:bg-accent hover:text-accent-foreground",
                isSelected ? "bg-accent text-accent-foreground border-ring ring-2 ring-ring" : "bg-background",
                isToday && !isSelected ? "ring-2 ring-primary" : "",
              ].join(" ")}
              style={
                !isSelected && weekendBg
                  ? { backgroundColor: weekendBg }
                  : undefined
              }
            >
              <div className="flex items-center justify-between">
                <div className={"text-sm " + (isSelected ? "font-bold" : isToday ? "font-semibold" : "font-medium")}>
                  {date.getDate()}
                </div>
                <div className="flex items-center gap-1" aria-hidden>
                  {previewDots}
                </div>
              </div>
              <div className="mt-1 space-y-1 overflow-hidden">
                {dayShifts.slice(0, 3).map((s, i) => (
                  <div
                    key={`${key}-item-${s.id ?? i}`}
                    className="truncate text-xs"
                    title={
                      [s.unitName, s.userName, s.start && s.end ? `${timeHM(s.start)}–${timeHM(s.end)}` : null]
                        .filter(Boolean)
                        .join(" · ") as string
                    }
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                      style={{ background: s.color || "#2563eb" }}
                    />
                    <span className="align-middle">
                      {s.unitName || "Unit"}
                      {s.userName ? ` · ${s.userName}` : ""}
                    </span>
                  </div>
                ))}
                {dayShifts.length > 3 ? (
                  <div className="text-[11px] text-muted-foreground">+{dayShifts.length - 3} more…</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          [data-printable="true"] button { display: none !important; }
          [data-printable="true"] .print\\:hidden { display: none !important; }
          [data-printable="true"] .border { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Small utils
// ──────────────────────────────────────────────────────────────────────────────
function timeHM(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
