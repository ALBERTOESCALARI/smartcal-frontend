import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Capitalize the first letter of a string
export function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Truncate a string with ellipsis
export function truncate(str: string, maxLength: number): string {
  if (!str) return "";
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

// Format a date as YYYY-MM-DD
export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
}

// Format a date with time as YYYY-MM-DD HH:mm
export function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  const iso = d.toISOString();
  return iso.slice(0, 10) + " " + iso.slice(11, 16);
}

// Sleep for a given ms (async)
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Safe JSON parse with fallback
export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
// Format integer cents as localized currency (default USD)
export function formatCurrencyCents(
  cents: number | null | undefined,
  currency = "USD",
  locale?: string
): string {
  if (cents == null || !Number.isFinite(Number(cents))) return "";
  const value = Number(cents) / 100;
  return new Intl.NumberFormat(locale ?? undefined, {
    style: "currency",
    currency,
  }).format(value);
}

// Compute earnings in cents from elapsed milliseconds and hourly rate (cents/hour)
export function earningsFromElapsedMs(
  elapsedMs: number,
  hourlyRateCents: number
): number {
  const hours = elapsedMs / 3_600_000; // 1h = 3.6M ms
  return Math.round(hours * hourlyRateCents);
}

// Resolve hourly rate (in cents) from shift or user objects
export function resolveHourlyRateCents(args: {
  activeShift?: any | null;
  sessionUser?: any | null;
}): number | null {
  const shiftRate =
    args.activeShift?.hourly_rate_cents ?? args.activeShift?.pay_rate_cents ?? null;
  if (Number.isFinite(shiftRate)) return Number(shiftRate);

  const userRate =
    args.sessionUser?.hourly_rate_cents ?? args.sessionUser?.pay_rate_cents ?? null;
  if (Number.isFinite(userRate)) return Number(userRate);

  return null;
}