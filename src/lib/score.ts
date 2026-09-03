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
 */

import type { RouteFacts } from "./overpass.ts";

export type Verdict = "good" | "fair" | "poor" | "unknown";

export interface Assessment {
  /** 0–100, higher is better. Null when the map says too little to judge. */
  score: number | null;
  verdict: Verdict;
  /** 0–1: how much of the route the map actually described. */
  confidence: number;
  /** Short factual statements, each one checkable against the counts. */
  findings: string[];
  /** True when the hour means lighting dominates the answer. */
  afterDark: boolean;
}

/** Roughly, is it dark? Deliberately crude — the exact minute does not matter. */
export function isAfterDark(hour: number): boolean {
  return hour >= 20 || hour < 6;
}

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

export function assess(facts: RouteFacts, hour: number): Assessment {
  const afterDark = isAfterDark(hour);
  const findings: string[] = [];

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
   * believed.
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
      afterDark,
      findings: [
        `OpenStreetMap records lighting for ${Math.round(coverage * 100)}% of this route, which is too little to judge it.`,
        "That is a gap in the map, not a dark street — and not a safe one either.",
      ],
    };
  }

  let score = 55;

  if (afterDark) {
    // Lighting is most of the answer at night, so it moves the score most.
    score += (litKnownFraction - 0.5) * 60;
    if (lampsPerKm >= 20) { score += 8; findings.push(`${facts.lamps} street lamps mapped along it.`); }
    else if (lampsPerKm > 0 && lampsPerKm < 5) { score -= 6; findings.push(`Only ${plural(facts.lamps, "street lamp", "street lamps")} mapped along ${km.toFixed(1)} km.`); }

    if (facts.greenSamples > facts.samples * 0.25) {
      score -= 12;
      findings.push("A quarter or more of it runs through parkland, which empties out after dark.");
    }
    if (venuesPerKm < 3) {
      score -= 8;
      findings.push(`Little open frontage — ${plural(facts.venues, "shop or cafe", "shops or cafes")} along the way.`);
    }
  } else {
    // By day lighting barely matters; company and crossings do.
    score += (litKnownFraction - 0.5) * 15;
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
    score -= afterDark ? 14 : 6;
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

  return { score, verdict, confidence: Number(confidence.toFixed(2)), afterDark, findings };
}
