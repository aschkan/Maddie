/**
 * The Crime layer — and what is actually behind it.
 *
 * There is no open dataset of where harassment, catcalling, assault or rape
 * happened. Police forces publish counts per neighbourhood per month, which
 * cannot say anything about one street versus the next one over, and the
 * categories that matter most here are the ones least likely to be reported at
 * all. Drawing purple dots from a national statistics table would look like
 * this layer answers the question. It does not.
 *
 * So the layer holds what people using this app choose to record, and nothing
 * else. It starts empty, it stays in the browser that entered it, and it never
 * touches the score — `score.ts` is computed from OpenStreetMap alone. An
 * empty map here means nobody has written anything down, which is not the same
 * as nothing having happened, and the panel says so rather than leaving the
 * blank space to be read as reassurance.
 */

import type { LatLng } from "./osrm.ts";

export interface CrimeCategory {
  id: string;
  label: string;
}

/** The categories from the brief, in the order they were asked for. */
export const CRIME_CATEGORIES: CrimeCategory[] = [
  { id: "harassment", label: "Harassment" },
  { id: "catcalling", label: "Catcalling" },
  { id: "sexual_abuse", label: "Sexual abuse" },
  { id: "assault", label: "Assault or robbery" },
  { id: "rape", label: "Rape" },
  { id: "murder", label: "Murder" },
  { id: "other", label: "Other" },
];

const CATEGORY_IDS = new Set(CRIME_CATEGORIES.map((c) => c.id));

export interface Report {
  id: string;
  category: string;
  point: LatLng;
  /** ISO 8601, in whatever the reporting browser thought the time was. */
  at: string;
  note?: string;
}

export const STORAGE_KEY = "maddie.reports.v1";

/**
 * A cap, so a stuck loop cannot fill the browser's quota.
 *
 * Oldest first out: the newest reports are the ones anyone is looking at.
 */
export const MAX_REPORTS = 500;

/**
 * Whatever came out of storage → reports.
 *
 * Storage is text that anything could have written — an older version of this
 * app, another tab, a person with the console open. Every field is checked and
 * anything that does not survive is dropped rather than defaulted: a report at
 * 0,0 would draw a marker in the Gulf of Guinea, and a report with an unknown
 * category would be invisible to every filter while still being counted.
 */
export function parseReports(raw: unknown): Report[] {
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
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<Report> & { point?: Partial<LatLng> };

    const lat = item.point?.lat;
    const lng = item.point?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

    if (typeof item.category !== "string" || !CATEGORY_IDS.has(item.category)) continue;
    if (typeof item.id !== "string" || item.id.length === 0) continue;
    if (typeof item.at !== "string" || Number.isNaN(Date.parse(item.at))) continue;

    // Left off entirely rather than set to undefined, so a report round-trips
    // through JSON unchanged — `{note: undefined}` comes back without the key.
    const note = typeof item.note === "string" ? item.note.trim().slice(0, 280) : "";
    reports.push({
      id: item.id,
      category: item.category,
      point: { lat, lng },
      at: item.at,
      ...(note ? { note } : {}),
    });
  }
  return reports.slice(-MAX_REPORTS);
}

/** Add one, keeping the list inside its cap. Returns a new list. */
export function addReport(reports: readonly Report[], report: Report): Report[] {
  return [...reports, report].slice(-MAX_REPORTS);
}

export function removeReport(reports: readonly Report[], id: string): Report[] {
  return reports.filter((report) => report.id !== id);
}

/**
 * Storage, if this browser has any.
 *
 * Private windows, blocked site data and quota errors all throw here, and a
 * page that cannot save a note is still a page that draws a map — so every
 * access is wrapped and a failure costs the note, not the app.
 */
export function loadReports(storage: Pick<Storage, "getItem"> | null | undefined): Report[] {
  try {
    return parseReports(storage?.getItem(STORAGE_KEY) ?? null);
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
