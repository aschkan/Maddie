/**
 * A safety read for a route, computed from the map.
 *
 * The number is worked out HERE, in code, from counts anyone can check. The
 * model's job is to put it into words — see `src/lib/ai.ts`. That split is the
 * point: a small local model asked to invent a safety score would produce a
 * confident number with nothing behind it, and this is not a subject to be
 * confidently wrong about.
 *
 * Confidence is reported separately and honestly. Most streets in most of the
 * world carry no `lit` tag at all, and an unlit street and an unmapped one look
 * identical in the data — so coverage is stated rather than assumed away.
 *
 * The same function scores a whole route and a 400 m stretch of one — see
 * `segments.ts`, which builds a `RouteFacts` per window and calls straight back
 * in here. Two resolutions, one set of weights, so the parts can never disagree
 * with the whole about what a lit street is worth.
 */

import { crudeLight, lightFromElevation, minutesAfterSunset, plannedAt, solarElevationDeg, type Light } from "./daylight.ts";
import type { LatLng } from "./osrm.ts";
import type { RouteFacts } from "./overpass.ts";

export type Verdict = "good" | "fair" | "poor" | "unknown";

/**
 * When the walk is, and where — because "dark" is a fact about the sky.
 *
 * `point` is what makes the difference: with somewhere to stand, the sun's
 * elevation is worked out properly; without one, `hour` falls back to the old
 * clock rule and `sunDeg` comes back null so the caller can tell the two apart.
 */
export interface When {
  /** 0–23, read in the viewer's own timezone. See `daylight.ts`. */
  hour: number;
  /** Somewhere on the route. Null or absent forces the crude fallback. */
  point?: LatLng | null;
  /** The instant being planned for. Defaults to today at `hour`:00. */
  at?: Date;
}

/** A bare hour still works — it just cannot know where the sun is. */
export type Timing = number | When;

export interface Assessment {
  /** 0–100, higher is better. Null when the map says too little to judge. */
  score: number | null;
  verdict: Verdict;
  /** 0–1: how much of the route the map actually described. */
  confidence: number;
  /** Short factual statements, each one checkable against the counts. */
  findings: string[];
  /** Day, civil twilight, or night — what the lighting weight turns on. */
  light: Light;
  /**
   * The sun's elevation in degrees, or null when it could not be worked out
   * and the clock rule stood in. Null is the honest marker for "guessed".
   */
  sunDeg: number | null;
}

/**
 * How much the lighting evidence is allowed to move the score.
 *
 * At night it is most of the answer. By day it barely matters — you can see.
 * Twilight is neither, and was the state that did not exist before: folding it
 * into night made an Amsterdam evening in June a dark street, and folding it
 * into day made a Tehran evening in December a bright one.
 */
const LIT_WEIGHT: Record<Light, number> = { night: 60, twilight: 34, day: 15 };

/**
 * How much the darkness penalties — empty parkland, no frontage, few lamps —
 * count for. They are about being somewhere alone in the dark, so they fade
 * with the light rather than switching off at a threshold.
 */
const DARK_WEIGHT: Record<Light, number> = { night: 1, twilight: 0.5, day: 0 };

function fraction(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/**
 * "1 street lamp", "4 street lamps".
 *
 * Both forms are passed in rather than an "s" appended, because appending to a
 * phrase gives "0 shop or cafes". A stray plural reads as a broken app, and
 * this text sits directly under a safety verdict.
 */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "1 h 20 min", for a span of minutes. */
function spell(minutes: number): string {
  const whole = Math.abs(Math.round(minutes));
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

interface Lighting {
  light: Light;
  /** Null when the clock rule stood in for a real sun position. */
  sunDeg: number | null;
  /** A checkable sentence about the sky, or null when there is nothing to say. */
  note: string | null;
}

/**
 * Work out how light it is — properly where possible, crudely where not.
 *
 * The crude branch is not a bug to be removed: `assess` is also called from the
 * API route, which may be handed facts and an hour and nothing else, and an
 * hour alone genuinely cannot say where the sun is. What it must not do is
 * pretend otherwise, so `sunDeg` stays null and no sentence about the sun is
 * produced.
 */
export function lightingFor(timing: Timing): Lighting {
  if (typeof timing === "number") {
    return { light: crudeLight(timing), sunDeg: null, note: null };
  }

  const point = timing.point;
  if (!point) return { light: crudeLight(timing.hour), sunDeg: null, note: null };

  const at = timing.at ?? plannedAt(timing.hour);
  const sunDeg = solarElevationDeg(at, point);
  const light = lightFromElevation(sunDeg);
  const down = Math.round(Math.abs(sunDeg) * 10) / 10;

  if (light === "day") {
    return { light, sunDeg, note: null };
  }

  const since = minutesAfterSunset(at, point);
  if (light === "twilight") {
    return {
      light,
      sunDeg,
      note: `The sun is ${down}° below the horizon at that hour — dusk, not yet full dark.`,
    };
  }

  return {
    light,
    sunDeg,
    note:
      since !== null && since > 0
        ? `The sun set ${spell(since)} before that hour.`
        : `The sun is ${down}° below the horizon at that hour.`,
  };
}

export function assess(facts: RouteFacts, timing: Timing): Assessment {
  const { light, sunDeg, note } = lightingFor(timing);
  const findings: string[] = note ? [note] : [];

  const known = facts.litSamples + facts.unlitSamples;
  const rawLitFraction = fraction(facts.litSamples, known);
  // What share of the route the map says anything about lighting for.
  const coverage = fraction(known, facts.samples);
  const km = Math.max(0.1, facts.lengthM / 1000);
  const venuesPerKm = facts.venues / km;
  const lampsPerKm = facts.lamps / km;

  /*
   * Pull the lit fraction towards neutral when it rests on few samples.
   *
   * Two lit points and no unlit ones is "100% lit" arithmetically, and treating
   * it as such produced a confident green verdict from a route whose lighting
   * was mapped for 1% of its length. Full weight needs about fifteen known
   * points; below that the evidence is shrunk towards "no idea" rather than
   * believed. It is also what sets the window size in `segments.ts`.
   */
  const weight = Math.min(1, known / 15);
  const litKnownFraction = 0.5 + (rawLitFraction - 0.5) * weight;

  /*
   * Too little to judge. Saying "fair" here would be inventing an answer out of
   * an empty map, which is the one thing this must not do — and after dark, a
   * route nobody has mapped the lighting of is exactly when a confident
   * reassurance would be most harmful.
   *
   * Gated on coverage and lamp DENSITY, not on a lamp existing. A single mapped
   * lamp beside a 3 km route is not evidence that the route is lit, and an
   * earlier version let exactly that rescue a route with 1% coverage into a
   * green "looks fine".
   */
  if (coverage < 0.25 && lampsPerKm < 10) {
    return {
      score: null,
      verdict: "unknown",
      confidence: Math.min(coverage, 0.2),
      light,
      sunDeg,
      findings: [
        ...findings,
        `OpenStreetMap records lighting for ${Math.round(coverage * 100)}% of this route, which is too little to judge it.`,
        "That is a gap in the map, not a dark street — and not a safe one either.",
      ],
    };
  }

  let score = 55;
  score += (litKnownFraction - 0.5) * LIT_WEIGHT[light];

  const dark = DARK_WEIGHT[light];
  if (dark > 0) {
    // Lighting is most of the answer once the sun is down, so the things that
    // make being alone in the dark worse are weighed here and nowhere else.
    if (lampsPerKm >= 20) {
      score += 8 * dark;
      findings.push(`${facts.lamps} street lamps mapped along it.`);
    } else if (lampsPerKm > 0 && lampsPerKm < 5) {
      score -= 6 * dark;
      findings.push(`Only ${plural(facts.lamps, "street lamp", "street lamps")} mapped along ${km.toFixed(1)} km.`);
    }

    if (facts.greenSamples > facts.samples * 0.25) {
      score -= 12 * dark;
      findings.push(
        light === "night"
          ? "A quarter or more of it runs through parkland, which empties out after dark."
          : "A quarter or more of it runs through parkland, which empties out as the light goes.",
      );
    }
    if (venuesPerKm < 3) {
      score -= 8 * dark;
      findings.push(`Little open frontage — ${plural(facts.venues, "shop or cafe", "shops or cafes")} along the way.`);
    }
  } else {
    // By day lighting barely matters; company and crossings do.
    if (facts.greenSamples > facts.samples * 0.25) {
      score += 4;
      findings.push("Much of it runs through parkland.");
    }
  }

  if (venuesPerKm >= 12) {
    score += 10;
    findings.push(`Busy frontage — ${facts.venues} shops, cafes or bars along it.`);
  }
  if (facts.tunnels > 0) {
    score -= 6 + 8 * dark;
    findings.push(`${plural(facts.tunnels, "tunnel or underpass", "tunnels or underpasses")} on the way.`);
  }
  if (facts.footwaySamples > facts.samples * 0.5) {
    findings.push("Mostly on footpaths rather than beside traffic.");
  }
  if (facts.unlitSamples > 0) {
    findings.push(`${facts.unlitSamples} of ${facts.samples} points are on streets mapped as unlit.`);
  }
  if (facts.litSamples > 0) {
    findings.push(`${facts.litSamples} of ${facts.samples} points are on streets mapped as lit.`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Coverage caps how much any of this can be trusted, and a short route is
  // thin evidence however well mapped it is.
  const confidence = Math.min(1, coverage * 0.8 + Math.min(facts.samples / 40, 1) * 0.2);

  const verdict: Verdict = score >= 70 ? "good" : score >= 45 ? "fair" : "poor";

  // 0.6, not 0.5: with exactly half the route unmapped this still needs saying.
  if (coverage < 0.6) {
    findings.unshift(
      `Lighting is mapped for ${Math.round(coverage * 100)}% of the route; the rest is unknown rather than dark.`,
    );
  }

  return { score, verdict, confidence: Number(confidence.toFixed(2)), light, sunDeg, findings };
}
