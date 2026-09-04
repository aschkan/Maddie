/**
 * Example data for the crime layer.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * None of what this file produces happened. It exists so the filter panel, the
 * markers and the category checkboxes can be seen working before there is any
 * real material to put behind them — the interviews this layer is waiting on.
 *
 * So every point it makes carries `source: "example"`, and the app is required
 * to treat that as a different thing from a report somebody typed: a hollow
 * dashed marker instead of a solid one, "EXAMPLE DATA" at the top of the popup,
 * a standing banner in the panel while any of them are loaded, and one click to
 * clear them. A fabricated point on a real street is a claim about a real
 * place, and the only thing that stops it being read as one is that the screen
 * says so everywhere the point appears.
 *
 * Two things this deliberately does NOT do:
 *
 *   * It does not write plausible first-person notes. The notes are visibly
 *     placeholder text. Invented testimony about an assault is exactly the
 *     material the real interviews will supply, and a convincing fake of it
 *     sitting in the same database is how a fake ends up quoted as a finding.
 *
 *   * It does not place points at street-level precision. Each one is scattered
 *     inside a district, because a district is the most this knows — it is not
 *     pretending to name a doorway.
 *
 * The generator is deterministic: the same options give the same points, so a
 * reseed does not silently invent a different fictional city each time.
 */

import type { LatLng } from "./osrm.ts";
import { CRIME_CATEGORIES, type Report } from "./reports.ts";

export interface SeedArea {
  id: string;
  name: string;
  centre: LatLng;
  /** Points are scattered within roughly this far of the centre. */
  radiusM: number;
  /** Relative share of the total. */
  weight: number;
  profile: ProfileName;
}

type ProfileName = "nightlife" | "transit" | "park" | "highstreet" | "residential";

/**
 * Which categories each kind of place draws from.
 *
 * These are shares of a fictional dataset, not measured rates. They are shaped
 * only so the demo is not uniform noise — a nightlife strip and a quiet
 * residential street should not produce the same mix, or the layer teaches the
 * viewer nothing about what the filters do.
 */
const PROFILES: Record<ProfileName, Record<string, number>> = {
  nightlife:   { catcalling: 34, harassment: 30, sexual_abuse: 14, assault: 14, other: 6, rape: 2, murder: 0 },
  transit:     { harassment: 34, catcalling: 30, assault: 16, other: 12, sexual_abuse: 7, rape: 1, murder: 0 },
  park:        { harassment: 30, catcalling: 22, assault: 20, other: 14, sexual_abuse: 11, rape: 3, murder: 0 },
  highstreet:  { catcalling: 42, harassment: 32, other: 12, assault: 9, sexual_abuse: 5, rape: 0, murder: 0 },
  residential: { harassment: 34, catcalling: 26, other: 22, assault: 12, sexual_abuse: 5, rape: 1, murder: 0 },
};

/**
 * Amsterdam, because this deployment is `REGION=NL`.
 *
 * Coordinates are district centres, and nothing here is finer than that — see
 * the note at the top about not naming doorways.
 */
export const AMSTERDAM_AREAS: SeedArea[] = [
  { id: "centrum",      name: "Centrum / De Wallen",    centre: { lat: 52.3740, lng: 4.8960 }, radiusM: 550, weight: 16, profile: "nightlife" },
  { id: "leidseplein",  name: "Leidseplein",            centre: { lat: 52.3640, lng: 4.8830 }, radiusM: 380, weight: 12, profile: "nightlife" },
  { id: "rembrandt",    name: "Rembrandtplein",         centre: { lat: 52.3660, lng: 4.8960 }, radiusM: 330, weight: 11, profile: "nightlife" },
  { id: "centraal",     name: "Centraal Station",       centre: { lat: 52.3790, lng: 4.9000 }, radiusM: 420, weight: 10, profile: "transit" },
  { id: "zuid",         name: "Station Zuid",           centre: { lat: 52.3390, lng: 4.8730 }, radiusM: 450, weight: 6,  profile: "transit" },
  { id: "sloterdijk",   name: "Station Sloterdijk",     centre: { lat: 52.3890, lng: 4.8380 }, radiusM: 480, weight: 5,  profile: "transit" },
  { id: "vondelpark",   name: "Vondelpark",             centre: { lat: 52.3580, lng: 4.8686 }, radiusM: 700, weight: 7,  profile: "park" },
  { id: "westerpark",   name: "Westerpark",             centre: { lat: 52.3866, lng: 4.8720 }, radiusM: 600, weight: 5,  profile: "park" },
  { id: "oosterpark",   name: "Oosterpark",             centre: { lat: 52.3585, lng: 4.9200 }, radiusM: 520, weight: 4,  profile: "park" },
  { id: "dePijp",       name: "De Pijp",                centre: { lat: 52.3540, lng: 4.8920 }, radiusM: 650, weight: 8,  profile: "highstreet" },
  { id: "jordaan",      name: "Jordaan",                centre: { lat: 52.3740, lng: 4.8790 }, radiusM: 620, weight: 6,  profile: "highstreet" },
  { id: "javastraat",   name: "Javastraat / Indische Buurt", centre: { lat: 52.3660, lng: 4.9370 }, radiusM: 600, weight: 5, profile: "highstreet" },
  { id: "noord",        name: "Noord / NDSM",           centre: { lat: 52.4010, lng: 4.8930 }, radiusM: 800, weight: 3,  profile: "residential" },
  { id: "bijlmer",      name: "Bijlmer / Zuidoost",     centre: { lat: 52.3170, lng: 4.9470 }, radiusM: 900, weight: 2,  profile: "residential" },
];

/** Notes that could never be mistaken for something a person said. */
const PLACEHOLDER_NOTES = [
  "Example note — placeholder text, not from an interview.",
  "Example note — this record was generated by npm run seed.",
  "Example note — replace with real interview material.",
  "Example note — no incident is described here.",
];

/**
 * mulberry32 — a small deterministic PRNG.
 *
 * `Math.random()` would give a different fictional city on every reseed, which
 * makes "did the seed change or did I?" unanswerable when something looks odd.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a key from a weight map. Zero-weight entries are never chosen. */
function weighted(weights: Record<string, number>, roll: number): string {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return "other";
  let mark = roll * total;
  for (const [key, weight] of Object.entries(weights)) {
    mark -= weight;
    if (mark <= 0) return key;
  }
  return "other";
}

/**
 * Hours, weighted towards the dark.
 *
 * The whole app turns on whether it is dark, so example data clustered at
 * lunchtime would exercise none of it.
 */
const HOUR_WEIGHTS: number[] = [
  6, 5, 4, 3, 2, 2,     // 00–05
  2, 3, 3, 2, 2, 2,     // 06–11
  2, 2, 2, 3, 4, 5,     // 12–17
  6, 8, 10, 12, 12, 9,  // 18–23
];

function pickHour(roll: number): number {
  const total = HOUR_WEIGHTS.reduce((sum, value) => sum + value, 0);
  let mark = roll * total;
  for (let hour = 0; hour < HOUR_WEIGHTS.length; hour++) {
    mark -= HOUR_WEIGHTS[hour] ?? 0;
    if (mark <= 0) return hour;
  }
  return 22;
}

/** Metres → degrees, at this latitude. */
function offset(centre: LatLng, metresNorth: number, metresEast: number): LatLng {
  const latPerM = 1 / 111_320;
  const lngPerM = 1 / (111_320 * Math.max(0.2, Math.cos((centre.lat * Math.PI) / 180)));
  return { lat: centre.lat + metresNorth * latPerM, lng: centre.lng + metresEast * lngPerM };
}

export interface SeedOptions {
  /** How many example reports to make. */
  total?: number;
  areas?: readonly SeedArea[];
  /** Change this and you get a different fictional city. Same value, same city. */
  seed?: number;
  /** Epoch ms to count back from. Defaults to now. */
  now?: number;
  /** Spread the reports over this many days back from `now`. */
  days?: number;
}

export const DEFAULT_SEED_TOTAL = 180;

/**
 * Build the example reports.
 *
 * Pure and deterministic — no clock, no `Math.random`, no database — so the
 * test suite can check the shape of what the seed will write without running
 * the seed.
 */
export function buildSeedReports(options: SeedOptions = {}): Report[] {
  const total = Math.max(0, Math.floor(options.total ?? DEFAULT_SEED_TOTAL));
  const areas = (options.areas ?? AMSTERDAM_AREAS).filter((area) => area.weight > 0);
  const random = rng(options.seed ?? 20260904);
  const now = options.now ?? Date.now();
  const days = Math.max(1, options.days ?? 120);
  if (areas.length === 0 || total === 0) return [];

  const known = new Set(CRIME_CATEGORIES.map((category) => category.id));
  const weightTotal = areas.reduce((sum, area) => sum + area.weight, 0);

  const reports: Report[] = [];
  for (const area of areas) {
    const share = Math.round((area.weight / weightTotal) * total);
    const profile = PROFILES[area.profile];

    for (let n = 0; n < share; n++) {
      // Square root, so points spread over the disc rather than piling into
      // the middle of it.
      const distance = area.radiusM * Math.sqrt(random());
      const bearing = random() * Math.PI * 2;
      const point = offset(area.centre, Math.cos(bearing) * distance, Math.sin(bearing) * distance);

      const category = weighted(profile, random());
      // A profile that names a category this build has dropped would produce a
      // report no checkbox can show or hide.
      if (!known.has(category)) continue;

      const dayBack = Math.floor(random() * days);
      const when = new Date(now - dayBack * 86_400_000);
      when.setHours(pickHour(random()), Math.floor(random() * 60), 0, 0);

      reports.push({
        id: `seed-${area.id}-${n}`,
        category,
        point: { lat: Number(point.lat.toFixed(5)), lng: Number(point.lng.toFixed(5)) },
        at: when.toISOString(),
        note: PLACEHOLDER_NOTES[reports.length % PLACEHOLDER_NOTES.length],
        source: "example",
        area: area.name,
      });
    }
  }

  // Oldest first, so the cap in `addReport` drops the oldest example first.
  reports.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return reports;
}
