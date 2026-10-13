/**
 * The visual language of the dashboard — every colour, and the ONE thing it
 * means.
 *
 * READ `docs/Maddie-Evidence-Dashboard.md` BEFORE CHANGING ANYTHING HERE. This
 * file is that document's colour table, in code, and `test/palette.test.ts`
 * holds it to the rules the document states.
 *
 * The rules, short:
 *
 *   1. **One colour, one meaning.** Nothing here shares a colour with anything
 *      else, and the test fails if two meanings ever do. The earlier design
 *      used purple for the destination, "still loading" AND a crime report at
 *      once, and a participant read the reports as "cool places to visit".
 *   2. **Purple is community reports, and nothing else.** The evidence boards
 *      bring it back for exactly one meaning — a report somebody entered —
 *      paired with a SHAPE (a dot) that no place shares. The UI accent is not
 *      purple, the selection is not purple, no route is purple. The test checks
 *      every other hue stays out of the purple band.
 *   3. **No alarm red.** Nothing on these boards says "danger"; the test checks
 *      every hue.
 *   4. **The unknown is a category, drawn HATCHED.** Lighting nobody has tagged
 *      is neither lit nor unlit, and is never folded into either.
 *   5. **Shape carries meaning too**, so nothing depends on colour alone:
 *      hearts are places, dots are reports, a hatched area is a police figure,
 *      and the three routes differ by line style (solid / dashed / dotted).
 *   6. **Selection is blue.** The selected area, the brushed interval and the
 *      selected route's row are one idea — "what you picked" — in one colour.
 *
 * Two values per token, one per theme. Leaflet and the SVG charts take a
 * string, so these are hex rather than CSS variables; `globals.css` keeps the
 * same values as tokens, and the test checks the two agree.
 */

export type Tone = "day" | "night";

export interface Swatch {
  day: string;
  night: string;
}

export function pick(swatch: Swatch, tone: Tone): string {
  return tone === "night" ? swatch.night : swatch.day;
}

/** A report somebody entered — a purple DOT. Never scored, never weighted. */
export const REPORT: Swatch = { day: "#6d3fd0", night: "#a78bfa" };

/** A nearby place — a pink HEART. Somewhere with a door and usually a person. */
export const PLACE: Swatch = { day: "#ec4899", night: "#f472b6" };

/** Mapped lit — `lit=yes` in OpenStreetMap. Yellow, only ever light. */
export const LIGHT: Swatch = { day: "#f5c400", night: "#fbbf24" };

/** Mapped unlit — `lit=no`. A dark neutral: a fact about the street, not an alarm. */
export const UNLIT: Swatch = { day: "#3f3f46", night: "#a1a1aa" };

/** Lighting unknown — no tag at all. The colour of the HATCH, never a solid fill. */
export const UNKNOWN: Swatch = { day: "#b8bec8", night: "#64748b" };

/** What you picked: the selected area, the brushed interval, the selected row. */
export const SELECTION: Swatch = { day: "#2f6fe0", night: "#60a5fa" };

/** "All displayed records" — the comparison bar behind the selection. */
export const CONTEXT: Swatch = { day: "#d5d8de", night: "#475569" };

/** A stretch through a park, wood or scrub, on the timeline. */
export const PARK: Swatch = { day: "#c3c8cf", night: "#3f4c5f" };

/**
 * Police figures, from CBS. Not a hue at all: a HATCH over the whole
 * neighbourhood. Texture says "this is about the whole area, not a point".
 */
export const POLICE: Swatch = { day: "#475569", night: "#cbd5e1" };

/** A and B — black dots, labelled. The ends of a trip are not evidence. */
export const TRIP: Swatch = { day: "#111827", night: "#f8fafc" };

/**
 * The three routes, told apart by line style FIRST (solid, dashed, dotted) and
 * by ink second, so the comparison survives a greyscale print.
 */
export const ROUTE_INK: Swatch[] = [
  { day: "#13254d", night: "#e2e8f0" },
  { day: "#3d8fe0", night: "#38bdf8" },
  { day: "#71757d", night: "#94a3b8" },
];
export const ROUTE_DASH: (string | undefined)[] = [undefined, "9 7", "2 7"];

/**
 * The old verdict scale (Favourable / Mixed / Look closer / Not enough data).
 *
 * The evidence boards show no verdict — "there is no overall safety score" is
 * the thesis — so nothing on them draws these. They stay for `verdict.ts` and
 * `/api/assess`, which still exist; they are deliberately NOT in `MEANINGS`.
 */
import type { Verdict } from "./score.ts";

export const ROUTE: Record<Verdict, Swatch> = {
  good: { day: "#0f8a7a", night: "#2dd4bf" },
  fair: { day: "#e07a1f", night: "#fb923c" },
  poor: { day: "#9c3d17", night: "#e4572e" },
  unknown: { day: "#8a94a6", night: "#8a94a6" },
};

/**
 * Every token above with what it MEANS, for the test and the legends.
 */
export const MEANINGS: { meaning: string; swatch: Swatch; chromatic: boolean }[] = [
  { meaning: "a community report", swatch: REPORT, chromatic: true },
  { meaning: "a nearby place", swatch: PLACE, chromatic: true },
  { meaning: "mapped lit", swatch: LIGHT, chromatic: true },
  { meaning: "mapped unlit", swatch: UNLIT, chromatic: false },
  { meaning: "lighting unknown (hatched)", swatch: UNKNOWN, chromatic: false },
  { meaning: "your selection", swatch: SELECTION, chromatic: true },
  { meaning: "all displayed records", swatch: CONTEXT, chromatic: false },
  { meaning: "park segment", swatch: PARK, chromatic: false },
  { meaning: "police figures for an area", swatch: POLICE, chromatic: false },
  { meaning: "your trip: A and B", swatch: TRIP, chromatic: false },
  { meaning: "route A", swatch: ROUTE_INK[0]!, chromatic: true },
  { meaning: "route B", swatch: ROUTE_INK[1]!, chromatic: true },
  { meaning: "route C", swatch: ROUTE_INK[2]!, chromatic: false },
];

/** Hue in degrees, saturation 0–1, from a #rrggbb string. */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}
