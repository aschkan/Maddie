/**
 * The visual language of the map — every colour, and the ONE thing it means.
 *
 * READ `docs/Maddie-Design-System.md` BEFORE CHANGING ANYTHING HERE. This file
 * is that document's colour table, in code, and `test/palette.test.ts` holds it
 * to the rules the document states.
 *
 * The rules, short:
 *
 *   1. **One colour, one meaning.** Purple used to mean the destination, "still
 *      loading" AND a crime report, all on one screen — so a participant read
 *      the reports as "cool places to visit". Nothing here shares a colour with
 *      anything else, and the test fails if two meanings ever do.
 *   2. **Colour is for evidence.** Hue is spent only on things that say
 *      something about the streets: how the route reads, where it is lit,
 *      where there are places to go, where people reported something. Things
 *      that are merely YOURS — the start, the destination, the routes you did
 *      not pick — are black, white and grey. The supervisor's question was "why
 *      does the starting point need a colour?" and the answer is that it does
 *      not.
 *   3. **No purple and no red.** Purple is retired from the map entirely, so it
 *      cannot creep back into meaning two things. Red is not used to say
 *      "danger": the far end of the route scale is a rust brown that reads as
 *      "look closer", not as an alarm. The test checks every hue.
 *   4. **Grey means "not known".** A stretch OpenStreetMap says nothing about,
 *      and a route still being read, are both grey and both DASHED — the same
 *      statement, "we do not know yet", made the same way.
 *   5. **Shape carries meaning too**, so nothing depends on colour alone:
 *      hearts are places, speech bubbles are reports, hatching is a police
 *      figure for a whole area, a glow around the line is light.
 *
 * Two values per token, one per map tone. The basemap is a grey canvas by day
 * and near-black at night (see `globals.css`), and a colour that reads on one
 * vanishes on the other. Leaflet draws the routes onto a canvas and takes a
 * string, so these are hex rather than CSS variables; the CSS keeps a copy of
 * the chip colours as tokens, and the test checks the two agree.
 */

import type { Verdict } from "./score.ts";

export type Tone = "day" | "night";

export interface Swatch {
  day: string;
  night: string;
}

export function pick(swatch: Swatch, tone: Tone): string {
  return tone === "night" ? swatch.night : swatch.day;
}

/**
 * How a stretch of route reads, from the evidence along it.
 *
 * A diverging scale with no red and no purple: teal where the indicators are
 * favourable, through orange, to a rust brown where they are not. Teal and
 * orange are the pair most colour-vision deficiencies still tell apart, which
 * is why it is not green and red. Orange and rust differ by lightness, so they
 * stay apart in greyscale as well.
 */
export const ROUTE: Record<Verdict, Swatch> = {
  good: { day: "#0f8a7a", night: "#2dd4bf" },
  fair: { day: "#e07a1f", night: "#fb923c" },
  poor: { day: "#9c3d17", night: "#e4572e" },
  unknown: { day: "#8a94a6", night: "#8a94a6" },
};

/**
 * Light. Only ever light: lit streets, lamps, and the glow around the lit
 * stretches of your route. It is drawn as a GLOW — wide and soft — never as a
 * line of its own, because light spreads, and so a stretch of route can be
 * teal AND lit at once without the two colours fighting for the same pixels.
 */
export const LIGHT: Swatch = { day: "#e8b100", night: "#ffe27a" };

/**
 * Places to go — the pink heart. One colour and one shape for every kind of
 * place, so the map says "somewhere with a door, a light and usually a person"
 * without twelve icons fighting for attention. The kind is revealed on hover,
 * on a close zoom, and in the popup.
 */
export const PLACE: Swatch = { day: "#ff4f99", night: "#ff6fae" };

/**
 * Reports people entered. Blue, and a speech-bubble shape, because each one is
 * somebody telling you something — a voice, not an alarm. Never scored.
 */
export const REPORT: Swatch = { day: "#2563d8", night: "#76a9ff" };

/**
 * Police figures, from CBS. Not a hue at all: a HATCH over the whole
 * neighbourhood, denser where more offences were recorded. Texture is the one
 * channel nothing else uses, and it says "this is about the whole area, not
 * a point in it" before the popup is opened.
 */
export const POLICE: Swatch = { day: "#475569", night: "#cbd5e1" };

/**
 * Your trip — black, white and grey on purpose; see rule 2 above.
 *
 * A is a hollow ring: it marks where you are, which you already know. B is a
 * solid pin: where you are going, the one end that needs finding on the map.
 * Different fill, different shape, different weight — and neither competes
 * with the evidence colours for attention.
 */
export const START: Swatch = { day: "#6b7280", night: "#9ca3af" };
export const END: Swatch = { day: "#111827", night: "#f8fafc" };

/** The routes you did not choose. The trip's own ink, faded. */
export const ALTERNATIVE: Swatch = { day: "#111827", night: "#f8fafc" };
export const ALTERNATIVE_OPACITY = 0.38;

/** "Not known yet" — a route being read, a stretch nobody has mapped. Dashed. */
export const UNKNOWN_DASH = "2 8";

/**
 * Every token above with what it MEANS, for the test and the legend.
 *
 * Two entries are allowed to share a value only when they are the same meaning
 * by design — `ROUTE.unknown` is the grey of "not known", and so is a route
 * still loading. The trip's ink is shared by B and the alternatives because
 * both are simply "your trip", drawn in the same pen.
 */
export const MEANINGS: { meaning: string; swatch: Swatch; chromatic: boolean }[] = [
  { meaning: "route: indicators favourable", swatch: ROUTE.good, chromatic: true },
  { meaning: "route: mixed indicators", swatch: ROUTE.fair, chromatic: true },
  { meaning: "route: look closer", swatch: ROUTE.poor, chromatic: true },
  { meaning: "not known: no map data, or still loading", swatch: ROUTE.unknown, chromatic: false },
  { meaning: "light", swatch: LIGHT, chromatic: true },
  { meaning: "a place to go", swatch: PLACE, chromatic: true },
  { meaning: "a report somebody entered", swatch: REPORT, chromatic: true },
  { meaning: "police figures for an area", swatch: POLICE, chromatic: false },
  { meaning: "your trip: the start", swatch: START, chromatic: false },
  { meaning: "your trip: the destination and the other routes", swatch: END, chromatic: false },
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
