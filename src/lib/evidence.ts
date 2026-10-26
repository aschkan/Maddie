/**
 * The evidence dashboard's arithmetic. Pure, tested, no React.
 *
 * `docs/Maddie-Evidence-Dashboard.md` is the spec. Its one rule that every
 * function here keeps: **decompose, don't aggregate.** Nothing in this file
 * produces a single number for a route or an area. Each factor stays its own
 * figure — minutes, percent lit, percent unknown, places, metres of parkland —
 * so the reader can see the trade-off a score would have hidden ("B is best on
 * lighting and worst on parkland").
 *
 * The second rule: **the unknown is a category, never a gap.** A sample whose
 * street carries no `lit=*` tag is counted as unknown, drawn hatched, and never
 * folded into either lit or unlit.
 */

import { distanceM, distanceToPathM, pathLengthM } from "./geo.ts";
import { alwaysOpen, type Spot } from "./layers.ts";
import type { LatLng, Route } from "./osrm.ts";
import type { SampleRead } from "./overpass.ts";
import type { Report, ReportType, When } from "./reports.ts";
import type { City, District } from "./cities.ts";

/* ── report types ─────────────────────────────────────────────────────── */

export { REPORT_TYPES, type ReportType } from "./reports.ts";

/**
 * A stored category → the dashboard's type. The store already holds Pointer's
 * reasons (`reports.ts` maps the first board's categories on the way in), so
 * this is the identity with a guard.
 */
export function reportType(category: string): ReportType {
  return category === "experienced" || category === "witnessed" || category === "environment" ? category : "other";
}

/** When a report says the place feels unsafe, with "not given" as its own bin. */
export type WhenBin = When | "unknown";
export const WHEN_BINS: { id: WhenBin; label: string }[] = [
  { id: "dark", label: "Mostly after dark" },
  { id: "any", label: "Time makes no difference" },
  { id: "day", label: "Mostly by day" },
  { id: "unknown", label: "Not given" },
];
export function whenOf(report: Pick<Report, "when">): WhenBin {
  return report.when ?? "unknown";
}

/* ── geometry ─────────────────────────────────────────────────────────── */

/** Ray casting. The ring is not repeated at the end. */
export function pointInPolygon(point: LatLng, ring: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const crosses = (a.lat > point.lat) !== (b.lat > point.lat)
      && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Which district a point is in, or null outside every outline. */
export function districtOf(city: City, point: LatLng): District | null {
  return city.districts.find((district) => pointInPolygon(point, district.outline)) ?? null;
}

/**
 * Where a point falls along a path: metres from the start of the nearest
 * point on the line, and how far off the line it is.
 *
 * Projected on a local flat plane per segment — over a city walk the error is
 * centimetres, and the answer only positions a marker on a 0–100% track.
 */
export function projectAlong(path: readonly LatLng[], point: LatLng): { alongM: number; offM: number } {
  let best = { alongM: 0, offM: Number.POSITIVE_INFINITY };
  let walked = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const length = distanceM(a, b);
    const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
    const ky = 110_540;
    const bx = (b.lng - a.lng) * kx;
    const by = (b.lat - a.lat) * ky;
    const px = (point.lng - a.lng) * kx;
    const py = (point.lat - a.lat) * ky;
    const squared = bx * bx + by * by;
    const t = squared === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / squared));
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.offM) best = { alongM: walked + t * length, offM: off };
    walked += length;
  }
  return best;
}

/** The part of a path between two fractions of its length (0–1). */
export function subPath(path: readonly LatLng[], from: number, to: number): LatLng[] {
  if (path.length < 2) return [...path];
  const total = pathLengthM(path);
  const start = Math.max(0, Math.min(from, to)) * total;
  const end = Math.min(1, Math.max(from, to)) * total;
  const out: LatLng[] = [];
  let walked = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const length = distanceM(a, b);
    const segStart = walked;
    const segEnd = walked + length;
    walked = segEnd;
    if (segEnd < start || segStart > end || length === 0) continue;
    const at = (metres: number): LatLng => {
      const t = Math.max(0, Math.min(1, (metres - segStart) / length));
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    };
    if (out.length === 0) out.push(at(Math.max(start, segStart)));
    out.push(at(Math.min(end, segEnd)));
  }
  return out;
}

/* ── binning ──────────────────────────────────────────────────────────── */

/** Counts per bin of `width`, from `min` up to (not including) `max`. */
export function histogram(values: readonly number[], min: number, max: number, width: number): number[] {
  const bins = new Array<number>(Math.max(1, Math.ceil((max - min) / width))).fill(0);
  for (const value of values) {
    if (!Number.isFinite(value) || value < min || value >= max) continue;
    const index = Math.floor((value - min) / width);
    bins[index] = (bins[index] ?? 0) + 1;
  }
  return bins;
}

/** A round number at or above `value`, for an axis end: 1, 2, 2.5, 5 × 10ⁿ. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

/** Evenly spaced ticks from 0 to `max`, `count` gaps. */
export function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max * i) / count);
}

/* ── one route, decomposed ────────────────────────────────────────────── */

export type Lit = SampleRead["lit"];

/** A stretch of a route, as fractions of its length (0–1). */
export interface Run<T> {
  from: number;
  to: number;
  value: T;
}

export interface Mark<T> {
  /** Fraction of the route's length, 0–1. */
  at: number;
  item: T;
}

export interface RouteEvidence {
  minutes: number;
  lengthM: number;
  /** Percent of SAMPLES, each 0–100. Samples are every 25 m, so ≈ of length. */
  litPct: number;
  unlitPct: number;
  unknownPct: number;
  /** Metres of the route through a park, wood or scrub. */
  parklandM: number;
  lighting: Run<Lit>[];
  parks: Run<true>[];
  underpasses: Mark<string>[];
  places: Mark<Spot>[];
  reports: Mark<Report>[];
}

/** How far off the line a place still counts as nearby. Same as `alongside.ts`. */
export const PLACE_RADIUS_M = 100;
/** …and a report. */
export const REPORT_RADIUS_M = 75;

/**
 * Consecutive samples with the same value, merged into runs.
 *
 * Each sample stands for the stretch from itself to the next one, and the last
 * to the end of the route — so the runs tile the whole 0–1 with no gap. A gap
 * would draw as nothing, which is a third thing that is neither "lit" nor
 * "unknown" and is not a state the data has.
 */
export function runsOf<T>(reads: readonly SampleRead[], lengthM: number, value: (read: SampleRead) => T): Run<T>[] {
  if (reads.length === 0 || lengthM <= 0) return [];
  const runs: Run<T>[] = [];
  for (let i = 0; i < reads.length; i++) {
    const read = reads[i]!;
    const from = i === 0 ? 0 : Math.min(1, read.alongM / lengthM);
    const to = i + 1 < reads.length ? Math.min(1, reads[i + 1]!.alongM / lengthM) : 1;
    const v = value(read);
    const last = runs[runs.length - 1];
    if (last && last.value === v && Math.abs(last.to - from) < 1e-9) last.to = to;
    else runs.push({ from, to, value: v });
  }
  return runs.filter((run) => run.to > run.from);
}

export function routeEvidence(
  route: Pick<Route, "path" | "seconds" | "metres">,
  reads: readonly SampleRead[] | null,
  spots: readonly Spot[],
  reports: readonly Report[],
): RouteEvidence {
  const lengthM = pathLengthM(route.path) || route.metres;
  const known = reads ?? [];
  const samples = known.length;
  const share = (test: (read: SampleRead) => boolean) =>
    samples === 0 ? 0 : (100 * known.filter(test).length) / samples;

  const lighting = runsOf(known, lengthM, (read) => read.lit);
  const parks = runsOf(known, lengthM, (read) => read.green)
    .filter((run): run is Run<true> => run.value === true);
  const parklandM = parks.reduce((sum, run) => sum + (run.to - run.from) * lengthM, 0);

  const seenTunnel = new Set<string>();
  const underpasses: Mark<string>[] = [];
  for (const read of known) {
    if (!read.tunnelId || seenTunnel.has(read.tunnelId)) continue;
    seenTunnel.add(read.tunnelId);
    underpasses.push({ at: Math.min(1, read.alongM / lengthM), item: read.tunnelId });
  }

  const near = <T extends { point: LatLng }>(items: readonly T[], radius: number): Mark<T>[] => {
    const marks: Mark<T>[] = [];
    for (const item of items) {
      if (distanceToPathM(item.point, route.path as LatLng[]) > radius) continue;
      const { alongM } = projectAlong(route.path, item.point);
      marks.push({ at: Math.min(1, alongM / lengthM), item });
    }
    return marks.sort((a, b) => a.at - b.at);
  };

  return {
    minutes: route.seconds / 60,
    lengthM,
    litPct: share((read) => read.lit === "yes"),
    unlitPct: share((read) => read.lit === "no"),
    unknownPct: share((read) => read.lit === "unknown"),
    parklandM,
    lighting,
    parks,
    underpasses,
    places: near(spots, PLACE_RADIUS_M),
    reports: near(reports, REPORT_RADIUS_M),
  };
}

/* ── a brushed interval of one route ──────────────────────────────────── */

export interface IntervalSummary {
  lighting: string;
  openingHours: string;
  reports: string;
  /** The first report in the interval that says something, if any. */
  narrative: Report | null;
  places: number;
  reportCount: number;
}

/** The share of an interval each lighting state covers. */
export function lightingWithin(runs: readonly Run<Lit>[], from: number, to: number): Record<Lit, number> {
  const out: Record<Lit, number> = { yes: 0, no: 0, unknown: 0 };
  const span = Math.max(1e-9, to - from);
  for (const run of runs) {
    const overlap = Math.min(to, run.to) - Math.max(from, run.from);
    if (overlap > 0) out[run.value] += overlap / span;
  }
  return out;
}

/** What is known about lighting in an interval, in words that make no verdict. */
export function describeLighting(share: Record<Lit, number>): string {
  if (share.yes + share.no + share.unknown === 0) return "not read yet";
  if (share.unknown >= 0.5) return "mostly unknown";
  if (share.unknown >= 0.15) return "partly unknown";
  if (share.no >= 0.15) return "partly unlit";
  if (share.yes >= 0.85) return "lit throughout";
  return "mostly lit";
}

export function summariseInterval(evidence: RouteEvidence, from: number, to: number): IntervalSummary {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const inside = <T>(marks: readonly Mark<T>[]) => marks.filter((mark) => mark.at >= lo && mark.at <= hi);
  const places = inside(evidence.places).map((mark) => mark.item);
  const reports = inside(evidence.reports).map((mark) => mark.item);

  let openingHours = "unknown";
  if (places.length === 0) openingHours = "no places nearby";
  else if (places.some((place) => alwaysOpen(place.openingHours))) {
    openingHours = `${places.filter((place) => alwaysOpen(place.openingHours)).length} open 24/7`;
  } else if (places.some((place) => place.openingHours)) openingHours = "as tagged — not checked against the hour";

  let reportLine = "none marked here";
  if (reports.length > 0) {
    const stories = reports.filter((report) => report.note).length;
    reportLine = `${reports.length} marked place${reports.length === 1 ? "" : "s"}${stories ? ` · ${stories} with a story` : ""}`;
  }

  return {
    lighting: describeLighting(lightingWithin(evidence.lighting, lo, hi)),
    openingHours,
    reports: reportLine,
    narrative: reports.find((report) => report.note) ?? null,
    places: places.length,
    reportCount: reports.length,
  };
}

/**
 * Which routes the trade-off slider keeps: those within `extraMin` minutes of
 * the quickest. It FILTERS and never re-scores — a route outside the budget is
 * set aside, not marked down.
 */
export function withinBudget(minutes: readonly number[], extraMin: number): boolean[] {
  const finite = minutes.filter(Number.isFinite);
  if (finite.length === 0) return minutes.map(() => true);
  const quickest = Math.min(...finite);
  return minutes.map((value) => !Number.isFinite(value) || value <= quickest + extraMin + 1e-9);
}

/** "A", "B", "C"… */
export function routeLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** "YYYY-MM" for every month from one ISO day to another, inclusive, capped. */
export function monthKeys(from: string, to: string, cap = 36): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  while (out.length < cap) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    out.push(key);
    if (key >= endKey || !Number.isFinite(year)) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}
