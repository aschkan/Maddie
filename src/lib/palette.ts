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
 *   2. **A report is a DARK GREY dot, shaded by how serious it reads.** The
 *      meeting of 4 Nov 2026: "the purples are so positive … can we make it
 *      grey. Dark grey." Full-strength purple dots drowned the parks and the
 *      bridges. Reports are now a ColorBrewer Greys ramp (5 classes), tinted a
 *      few degrees violet so a dot never reads as the basemap's road grey, and
 *      paired with OPACITY and SIZE: the most serious rank is dark, opaque and
 *      a little larger; the lightest is little more than an outline. Which
 *      rank a report gets is `importance.ts`, and the reader can reorder it.
 *   3. **No alarm red.** Nothing on these boards says "danger"; the test checks
 *      every hue.
 *   4. **The unknown is a category, drawn HATCHED.** Lighting nobody has tagged
 *      is neither lit nor unlit, and is never folded into either.
 *   5. **Shape carries meaning too**, so nothing depends on colour alone:
 *      hearts are places, round dots are reports, squares are bars, ticks are
 *      busy streets, ∩ is an underpass, a hatched area is a police figure,
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

/** A report somebody entered — a dark grey DOT. Never scored, never weighted. */
export const REPORT: Swatch = { day: "#2f2a3d", night: "#e2dfea" };

/**
 * The five shades of a report, most serious first (rank 0 → 4). ColorBrewer
 * Greys, 5-class, lightness for lightness, tinted slightly violet so the dots
 * stay apart from the basemap's neutral road grey. At night the ramp runs the
 * other way round — the serious ones are the BRIGHT ones on a dark map.
 */
export const REPORT_RAMP: Swatch[] = [
  { day: "#252131", night: "#f4f2f8" },
  { day: "#46405a", night: "#d4d0de" },
  { day: "#6b6680", night: "#a9a4b8" },
  { day: "#9a96a8", night: "#827d90" },
  { day: "#c9c7d2", night: "#5e596b" },
];
/** Fill opacity per rank — the serious ones stand out, the light ones recede. */
export const REPORT_OPACITY = [0.95, 0.82, 0.62, 0.42, 0.18];
/** Dot radius per rank, in pixels. */
export const REPORT_RADIUS = [6.2, 5.4, 4.7, 4.1, 3.8];

/** People about: pedestrianised streets and squares — OSM's stand-in for footfall. */
export const CROWD: Swatch = { day: "#11898a", night: "#2cc8c8" };

/**
 * Bars, pubs, cafés and restaurants. A crowd, but not every crowd is
 * reassuring — participants named late-night drinking crowds as the kind that
 * is not. Shown as its OWN mark so the reader can tell the two apart.
 */
export const NIGHTLIFE: Swatch = { day: "#a6611a", night: "#d08c3c" };

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

/**
 * A stretch through a park, wood or scrub. GREEN — a participant read the old
 * grey band as something else entirely: "it's a park? Then show it with green."
 */
export const PARK: Swatch = { day: "#41ab5d", night: "#74c476" };

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
  { meaning: "a report (dark grey, shaded by how serious it reads)", swatch: REPORT, chromatic: false },
  { meaning: "a nearby place", swatch: PLACE, chromatic: true },
  { meaning: "mapped lit", swatch: LIGHT, chromatic: true },
  { meaning: "mapped unlit", swatch: UNLIT, chromatic: false },
  { meaning: "lighting unknown (hatched)", swatch: UNKNOWN, chromatic: false },
  { meaning: "your selection", swatch: SELECTION, chromatic: true },
  { meaning: "all displayed records", swatch: CONTEXT, chromatic: false },
  { meaning: "park segment", swatch: PARK, chromatic: true },
  { meaning: "busy streets and squares", swatch: CROWD, chromatic: true },
  { meaning: "bars, pubs and cafés", swatch: NIGHTLIFE, chromatic: true },
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
