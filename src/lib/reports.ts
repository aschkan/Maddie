/**
 * The reports layer — places somebody marked, and why. Never scored.
 *
 * Everything here is REAL, from one of three sources, and they are never mixed
 * up:
 *
 *   * `pointer`   — Pointer (KRO-NCRV)'s "Onveilige plekken" survey, imported
 *                   once into the database (`pointer.ts`). ~18k places across
 *                   the Netherlands. Must be credited wherever it is shown.
 *   * `admin`     — the study team entered it in `/admin` (fieldwork, a new
 *                   source found later).
 *   * `community` — somebody typed it into the public board.
 *
 * There is no example data any more. The seed used to invent reports and the
 * boards used to generate more in the browser; both are gone. A record that
 * still says `source: "example"` (an old database, an old browser) is DROPPED
 * by `parseReports` rather than shown — and never promoted to a real one.
 *
 * A report carries the Pointer survey's shape, because that is the dataset:
 * WHY the place feels this way (`reasons`, the first of which is `category`),
 * WHEN (`when` — after dark / by day / any time; there is no hour), how people
 * ADAPT (`adjustments`), the respondent's AGE BAND, and an optional story. `at`
 * is when it was reported, not when anything happened.
 *
 * It never touches the score — `score.ts` is computed from OpenStreetMap alone.
 */

import type { LatLng } from "./osrm.ts";

/** Why the place is marked. Pointer's three reasons, plus `other` for a record without one. */
export type ReportType = "experienced" | "witnessed" | "environment" | "other";

export const REPORT_TYPES: { id: ReportType; label: string; short: string }[] = [
  { id: "experienced", label: "Something happened to me here", short: "Happened to me" },
  { id: "witnessed", label: "Something happened to someone I know of", short: "Happened to others" },
  { id: "environment", label: "The surroundings feel threatening", short: "Feels threatening" },
  { id: "other", label: "Other / not given", short: "Other" },
];

const TYPE_IDS = new Set<string>(REPORT_TYPES.map((t) => t.id));

/**
 * The categories the first version of the board stored. A community report
 * filed under one of them answered "What happened here?", so it reads as
 * `experienced`; their `other` stays `other`.
 */
const LEGACY: Record<string, ReportType> = {
  harassment: "experienced", catcalling: "experienced", sexual_abuse: "experienced",
  assault: "experienced", rape: "experienced", murder: "experienced",
};

/** When a place feels unsafe, as the survey asks it. */
export type When = "dark" | "day" | "any";

export const WHEN_OPTIONS: { id: When; label: string }[] = [
  { id: "dark", label: "Mostly after dark" },
  { id: "day", label: "Mostly by day" },
  { id: "any", label: "Time makes no difference" },
];
const WHEN_IDS = new Set<string>(WHEN_OPTIONS.map((w) => w.id));

export type ReportSource = "pointer" | "admin" | "community";
const SOURCES = new Set<string>(["pointer", "admin", "community"]);

export const SOURCE_LABEL: Record<ReportSource, string> = {
  pointer: "Pointer survey",
  admin: "Study team",
  community: "Community report",
};

export interface Report {
  id: string;
  /** The primary reason — `reasons[0]`, or `other`. What the boards group by. */
  category: ReportType;
  point: LatLng;
  /** ISO 8601 — when it was REPORTED. Pointer gives a date only (stored at noon UTC). */
  at: string;
  /**
   * When the report date is only known as a WINDOW, its end; `at` is the start.
   * Pointer's v2 rows say "24-11-2025 - 10-06-2026". Never chart such a report
   * at `at` as if that were its day — `exactDay()` says whether it has one.
   */
  atUntil?: string;
  source: ReportSource;
  /** Every reason given, most direct first. */
  reasons?: ReportType[];
  when?: When;
  /** `ADJUSTMENTS` ids from `pointer.ts`. */
  adjustments?: string[];
  /** Respondent's age band, e.g. `26-35`. */
  age?: string;
  /** Town, as the survey placed it. */
  place?: string;
  /** The respondent's story, only where they consented to share it. */
  note?: string;
  /** Pointer: how many others also marked this place. */
  upvotes?: number;
  /** Pointer survey version. */
  form?: "v1" | "v2";
}

export const STORAGE_KEY = "maddie.reports.v1";

/** A cap on what one browser keeps, so a stuck loop cannot fill the quota. */
export const MAX_REPORTS = 500;

/** The longest note kept. Pointer stories run to ~2.3k characters. */
export const MAX_NOTE = 4_000;

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/**
 * Whatever came out of storage or a request → reports.
 *
 * Every field is checked and anything that does not survive is dropped rather
 * than defaulted: a report at 0,0 would draw in the Gulf of Guinea. An unmarked
 * source reads as `community` — but `example` is DROPPED, never promoted.
 */
export function parseReports(raw: unknown, cap = Infinity): Report[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  const reports: Report[] = [];
  for (const entry of value) {
    const report = parseReport(entry);
    if (report) reports.push(report);
  }
  return Number.isFinite(cap) ? reports.slice(-cap) : reports;
}

export function parseReport(entry: unknown): Report | null {
  if (!entry || typeof entry !== "object") return null;
  const item = entry as Record<string, unknown> & { point?: Partial<LatLng> };

  const lat = item.point?.lat;
  const lng = item.point?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (typeof item.id !== "string" || item.id.length === 0 || item.id.length > 120) return null;
  if (typeof item.at !== "string" || Number.isNaN(Date.parse(item.at))) return null;
  if (item.source === "example") return null;

  const rawCategory = typeof item.category === "string" ? item.category : "";
  const category: ReportType | undefined = TYPE_IDS.has(rawCategory) ? (rawCategory as ReportType) : LEGACY[rawCategory];
  if (!category) return null;

  const source: ReportSource = typeof item.source === "string" && SOURCES.has(item.source)
    ? (item.source as ReportSource)
    : "community";

  const reasons = Array.isArray(item.reasons)
    ? [...new Set(item.reasons.filter((r): r is ReportType => typeof r === "string" && TYPE_IDS.has(r) && r !== "other"))]
    : [];
  const when = typeof item.when === "string" && WHEN_IDS.has(item.when) ? (item.when as When) : undefined;
  const adjustments = Array.isArray(item.adjustments)
    ? [...new Set(item.adjustments.filter((a): a is string => typeof a === "string" && /^[a-z-]{1,24}$/.test(a)))]
    : [];
  const age = str(item.age, 12);
  const place = str(item.place, 120);
  const note = str(item.note, MAX_NOTE);
  const upvotes = typeof item.upvotes === "number" && Number.isInteger(item.upvotes) && item.upvotes > 0 ? item.upvotes : 0;
  const form = item.form === "v1" || item.form === "v2" ? item.form : undefined;
  const atUntil = typeof item.atUntil === "string" && !Number.isNaN(Date.parse(item.atUntil)) && item.atUntil > item.at
    ? item.atUntil
    : undefined;

  // Optional fields are left off rather than set to undefined, so a report
  // round-trips through JSON unchanged.
  return {
    id: item.id,
    category,
    point: { lat, lng },
    at: item.at,
    ...(atUntil ? { atUntil } : {}),
    source,
    ...(reasons.length ? { reasons } : {}),
    ...(when ? { when } : {}),
    ...(adjustments.length ? { adjustments } : {}),
    ...(age ? { age } : {}),
    ...(place ? { place } : {}),
    ...(note ? { note } : {}),
    ...(upvotes ? { upvotes } : {}),
    ...(form ? { form } : {}),
  };
}

/** Does this report have a known day (rather than a window)? */
export function exactDay(report: Pick<Report, "atUntil">): boolean {
  return !report.atUntil;
}

/** Does the report's date (or window) overlap `from`…`to` (YYYY-MM-DD, inclusive)? */
export function inDates(report: Pick<Report, "at" | "atUntil">, from: string, to: string): boolean {
  const start = report.at.slice(0, 10);
  const end = (report.atUntil ?? report.at).slice(0, 10);
  return end >= from && start <= to;
}

/** Add one, keeping the browser's list inside its cap. Returns a new list. */
export function addReport(reports: readonly Report[], report: Report): Report[] {
  return [...reports, report].slice(-MAX_REPORTS);
}

export function removeReport(reports: readonly Report[], id: string): Report[] {
  return reports.filter((report) => report.id !== id);
}

/**
 * Storage, if this browser has any. Private windows, blocked site data and
 * quota errors all throw here, and a failure costs the note, not the app.
 */
export function loadReports(storage: Pick<Storage, "getItem"> | null | undefined): Report[] {
  try {
    return parseReports(storage?.getItem(STORAGE_KEY) ?? null, MAX_REPORTS);
  } catch {
    return [];
  }
}

export function saveReports(
  storage: Pick<Storage, "setItem"> | null | undefined,
  reports: readonly Report[],
): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(reports));
    return true;
  } catch {
    return false;
  }
}

/** An id that does not need `crypto.randomUUID`, which older browsers lack. */
export function newReportId(now: number, random: number): string {
  return `r${now.toString(36)}${Math.floor(random * 1e6).toString(36)}`;
}

/**
 * How old a report is, as the three steps the legend shows. Recency is drawn
 * as OPACITY — a judgement for the reader, so old reports are shown, faded.
 */
export function reportAge(at: string, now: number): "recent" | "year" | "older" {
  const days = (now - Date.parse(at)) / 86_400_000;
  if (!Number.isFinite(days) || days < 90) return "recent";
  return days < 365 ? "year" : "older";
}
export const AGE_OPACITY = { recent: 1, year: 0.62, older: 0.32 } as const;
