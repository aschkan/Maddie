/**
 * The route, in stretches.
 *
 * A whole walk gets one score, and one score cannot say the useful thing. "61
 * out of 100" over 4 km is an average of a well-lit high street and the 400 m
 * of unlit park path in the middle, and the average is precisely the part you
 * cannot act on. What you can act on is "the dark part is here" — so the same
 * counts are re-summed over windows along the line, each window is scored by
 * the SAME `assess()` the whole route is, and the worst one is named.
 *
 * One scoring function at two resolutions, deliberately. A second set of
 * weights for segments would be a second opinion about what a lit street is
 * worth, and the two would drift.
 *
 * Everything here is pure: it takes the per-point reads `overpass.ts` already
 * produced and returns geometry and numbers. Nothing is fetched, so changing
 * the hour re-cuts and re-scores the whole route without asking OpenStreetMap
 * anything again.
 */

import { formatDistance } from "./format.ts";
import type { LatLng } from "./osrm.ts";
import type { RouteFacts, SampleRead } from "./overpass.ts";
import { assess, type Timing, type Verdict } from "./score.ts";

/**
 * How long a stretch is.
 *
 * Set by the evidence, not by the map: `score.ts` gives the lit fraction full
 * weight at about fifteen known samples, and samples are taken every 25 m, so
 * 400 m is the shortest window that can carry a confident lighting reading at
 * all. Shorter windows look sharper on the map and are mostly noise — each one
 * would swing on two or three points.
 */
export const WINDOW_M = 400;

/**
 * A tail shorter than this is folded into the window before it.
 *
 * Otherwise a 1.45 km route ends with a 50 m segment scored off two samples,
 * drawn as its own block of colour and quite possibly the "worst" one.
 */
export const RUNT_M = 150;

/**
 * How much worse a stretch has to be than its route before it is worth naming.
 *
 * Higher than `compare.ts`'s `MEANINGFUL_MARGIN` of 6, because a window rests
 * on a sixth of the samples a route does and so moves further on noise. Ten
 * points is a stretch that is genuinely a different kind of street.
 */
export const NOTABLE_DROP = 10;

export interface Segment {
  /** Metres from the start of the route, to metres from the start. */
  fromM: number;
  toM: number;
  /** The piece of line to draw. Sample points, so it follows the route. */
  path: LatLng[];
  score: number | null;
  verdict: Verdict;
  /** This stretch's own counts — the same shape the whole route has. */
  facts: RouteFacts;
  /** Streets OSM names along it, commonest first. Empty if none are named. */
  streets: string[];
}

/** Sum one window's reads into the same counts a whole route produces. */
function factsFor(window: SampleRead[], fromM: number, toM: number): RouteFacts {
  let litSamples = 0;
  let unlitSamples = 0;
  let unknownLitSamples = 0;
  let footwaySamples = 0;
  let greenSamples = 0;
  let lamps = 0;
  let venues = 0;
  let crossings = 0;
  const tunnels = new Set<string>();

  for (const read of window) {
    if (read.lit === "yes") litSamples++;
    else if (read.lit === "no") unlitSamples++;
    else unknownLitSamples++;

    if (read.footway) footwaySamples++;
    if (read.green) greenSamples++;
    if (read.tunnelId) tunnels.add(read.tunnelId);

    lamps += read.lamps;
    venues += read.venues;
    crossings += read.crossings;
  }

  return {
    lengthM: Math.round(toM - fromM),
    samples: window.length,
    litSamples,
    unlitSamples,
    unknownLitSamples,
    footwaySamples,
    greenSamples,
    lamps,
    venues,
    crossings,
    tunnels: tunnels.size,
  };
}

/** The named streets along a window, commonest first. */
function streetsIn(window: SampleRead[]): string[] {
  const counts = new Map<string, number>();
  for (const read of window) {
    if (!read.street) continue;
    counts.set(read.street, (counts.get(read.street) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** Cut the reads into windows of roughly `WINDOW_M`, by distance along. */
function windows(reads: SampleRead[]): SampleRead[][] {
  if (reads.length === 0) return [];

  const out: SampleRead[][] = [];
  let current: SampleRead[] = [];
  let startM = reads[0]?.alongM ?? 0;

  for (const read of reads) {
    current.push(read);
    if (read.alongM - startM >= WINDOW_M) {
      out.push(current);
      current = [];
      startM = read.alongM;
    }
  }
  if (current.length > 0) out.push(current);

  // Fold a short tail back into the window before it.
  const last = out[out.length - 1];
  const previous = out[out.length - 2];
  if (out.length > 1 && last && previous) {
    const span = (last[last.length - 1]?.alongM ?? 0) - (last[0]?.alongM ?? 0);
    if (span < RUNT_M) {
      previous.push(...last);
      out.pop();
    }
  }
  return out;
}

/**
 * Score every stretch of a route.
 *
 * A route shorter than one window comes back as a single segment rather than
 * as nothing: the caller draws whatever it is given, and an empty list would
 * silently leave a short walk uncoloured.
 */
export function segmentRoute(reads: SampleRead[], timing: Timing): Segment[] {
  const cut = windows(reads);
  const segments: Segment[] = [];

  for (let index = 0; index < cut.length; index++) {
    const window = cut[index];
    if (!window || window.length === 0) continue;

    const first = window[0];
    const last = window[window.length - 1];
    if (!first || !last) continue;

    const fromM = first.alongM;
    const toM = last.alongM;

    // The next window's first point closes the gap in the drawn line: without
    // it each segment stops 25 m short of the next and the route is dashed.
    const joint = cut[index + 1]?.[0];
    const path = window.map((read) => read.point);
    if (joint) path.push(joint.point);

    const facts = factsFor(window, fromM, toM);
    const assessment = assess(facts, timing);

    segments.push({
      fromM,
      toM,
      path,
      score: assessment.score,
      verdict: assessment.verdict,
      facts,
      streets: streetsIn(window),
    });
  }

  return segments;
}

/**
 * The stretch worth warning about, or null when there is not one.
 *
 * Null is the common and correct answer. A route that is uniformly mediocre has
 * no worst part worth pointing at, and inventing one — "the worst bit is this
 * arbitrary 400 m, which scores two points below the rest" — is the same error
 * `compare.ts` refuses to make between routes, at a finer grain where the
 * evidence is thinner still.
 */
export function worstStretch(segments: readonly Segment[], routeScore: number | null): Segment | null {
  if (routeScore === null) return null;

  const scored = segments.filter((segment) => segment.score !== null);
  // With one stretch, the stretch IS the route. Nothing is being singled out.
  if (scored.length < 2) return null;

  let worst: Segment | null = null;
  for (const segment of scored) {
    if (worst === null || (segment.score ?? 0) < (worst.score ?? 0)) worst = segment;
  }
  if (worst === null || worst.score === null) return null;

  return routeScore - worst.score >= NOTABLE_DROP ? worst : null;
}

/**
 * Where a stretch is, in words a person can act on.
 *
 * Named streets first, because that is what you can look for. An unnamed
 * stretch is placed by distance instead of being given a label the map does not
 * support — "the path through the park" would be a guess.
 */
export function describeStretch(segment: Segment): string {
  const length = formatDistance(segment.toM - segment.fromM);
  const [first, second] = segment.streets;

  if (first && second) return `${length} along ${first} and ${second}`;
  if (first) return `${length} along ${first}`;
  return `${length} starting ${formatDistance(segment.fromM)} in`;
}

/**
 * The sentence under the score, or null when no stretch stands out.
 *
 * Says the number AND what it is being compared against, because "38/100" on
 * its own reads as a verdict on the walk rather than on 400 m of it.
 */
export function describeWorst(segment: Segment | null, routeScore: number | null): string | null {
  if (!segment || segment.score === null || routeScore === null) return null;
  return `The worst stretch is the ${describeStretch(segment)} — ${segment.score}/100, against ${routeScore} for the route as a whole.`;
}
