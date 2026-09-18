/**
 * Placeholder data for the crime layer.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * None of what this file produces happened. It exists so the filter panel, the
 * markers and the category checkboxes can be exercised before there is real
 * material to put behind them — the interviews this layer is waiting on.
 *
 * Every point still carries `source: "example"` IN THE DATABASE, and that is
 * what makes it findable later: `npm run seed -- --no-demo` and the panel's
 * clear button both select on it, and `--keep` spares real reports by it. Do
 * not remove the field.
 *
 * What HAS changed is the presentation. `MARK_EXAMPLE_DATA` in
 * `src/lib/demo-mode.ts` is off, so these render exactly as a real report will
 * — a solid dot, an ordinary popup, no banner. The app is being evaluated as
 * it will look, and a screen covered in placeholder warnings is a screen that
 * will never ship. Read that file before turning it back on or leaving it off.
 *
 * ⚠ The consequence, stated plainly: with the marking off there is nothing on
 * screen that tells a seeded report from one a person filed. Clear this data
 * before anybody outside the team sees the app, and never quote a count from
 * it.
 *
 * The notes below are written in the register a real report is written in —
 * short, plain, what somebody would actually type into a form — because a
 * layer full of "Example note" tells you nothing about whether the popup, the
 * wrapping or the category filter work. They are still invented, they describe
 * nothing that happened to anybody, and they are deliberately kept to the
 * minimum a form would capture rather than elaborated into testimony.
 *
 * Points are scattered inside a district, never at street-level precision,
 * because a district is the most this knows — it is not naming a doorway.
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

/**
 * Notes, one per category, in the register somebody actually writes in.
 *
 * Short, factual, no elaboration — which is both what a form captures and the
 * limit worth keeping. Indexed by category so a `catcalling` point does not
 * carry a note about a break-in, because a filter that shows mismatched notes
 * is a filter you cannot test.
 */
const NOTES: Record<string, string[]> = {
  harassment: [
    "Group of men followed me for a few streets. Kept shouting after I crossed over.",
    "Someone blocked the pavement and would not let me past until people came.",
    "Man on a bike circled back twice. I went into a shop until he left.",
    "Followed from the tram stop to my door. Nothing happened but I changed my route after.",
    "Kept being spoken to at the bus stop after I said no. Nobody else waiting.",
  ],
  catcalling: [
    "Shouted at from a car. Happens here most evenings.",
    "Comments from a group outside the bar, every time I walk past after eleven.",
    "Two men on the corner. Same thing last week in the same spot.",
    "Whistling and comments from scaffolding. Daytime.",
    "Shouted at from a passing van. Second time this month on this street.",
  ],
  sexual_abuse: [
    "Someone pressed up against me on a crowded platform. Moved carriage.",
    "Touched on the way past in the crowd outside the club. Could not see who.",
    "Man exposed himself near the underpass. Reported to the police as well.",
  ],
  assault: [
    "Bag grabbed from my shoulder near the cashpoint. Two of them on a scooter.",
    "Phone snatched while I was looking at it waiting for the tram.",
    "Pushed against the wall and my bag taken. Happened fast, middle of the evening.",
    "Someone tried to take my bike off me at the rack behind the station.",
  ],
  rape: [
    "Reported to the police. Nothing further recorded here.",
  ],
  murder: [],
  other: [
    "Lights out along this whole stretch for weeks. Pitch dark by five.",
    "Group drinking in the underpass, blocking the only way through.",
    "Broken glass and nobody about. Feels bad every time I cycle it.",
    "Aggressive begging at the entrance, every day this week.",
    "Man shouting at people at random. Not aimed at me but I turned back.",
    "Path behind the flats is unlit and overgrown. Cannot see the end of it.",
  ],
};

/**
 * How often a report carries no note at all.
 *
 * A real crime layer is full of them: somebody drops a pin, picks a category
 * and does not want to write anything, which is a perfectly complete report.
 * Giving every seeded point a sentence would make a popup that never renders
 * its own empty state — and that state is the commonest one in the wild.
 */
const NO_NOTE_SHARE = 0.28;

/** A note for this category, or none — which is a complete report too. */
function noteFor(category: string, roll: number, skipRoll: number): string | undefined {
  const pool = NOTES[category];
  if (!pool || pool.length === 0) return undefined;
  if (skipRoll < NO_NOTE_SHARE) return undefined;
  return pool[Math.floor(roll * pool.length) % pool.length];
}

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

      // A category with no note pool gets no note at all, rather than a
      // borrowed one — an empty note is a real state of a real report and the
      // popup has to render it.
      const note = noteFor(category, random(), random());
      reports.push({
        id: `seed-${area.id}-${n}`,
        category,
        point: { lat: Number(point.lat.toFixed(5)), lng: Number(point.lng.toFixed(5)) },
        at: when.toISOString(),
        ...(note ? { note } : {}),
        source: "example",
        area: area.name,
      });
    }
  }

  // Oldest first, so the cap in `addReport` drops the oldest example first.
  reports.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return reports;
}
