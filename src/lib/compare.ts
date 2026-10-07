/**
 * Choosing between routes.
 *
 * The word on the badge is **Preferred**, never "Safe". Nothing here can tell
 * you that a street is safe — it can tell you that one of two ways round is
 * better lit and has more open frontage than the other, which is a different
 * and much smaller claim. The label has to match the claim.
 *
 * The other half of that honesty is refusing to pick. Two routes that score 61
 * and 63 are the same route as far as this data is concerned, and putting a
 * badge on one of them invents a distinction the map does not support.
 */

import type { Assessment } from "./score.ts";
import type { Route } from "./osrm.ts";

/**
 * How much better one route has to look before it is worth saying so.
 *
 * The score is built from sampled counts along a line; a few points either way
 * moves it by several. Six is comfortably above that noise and still small
 * enough to catch a real difference between a lit main road and a park path.
 */
export const MEANINGFUL_MARGIN = 6;

export interface Comparison {
  /** Index of the route to suggest, or null when nothing stands out. */
  preferred: number | null;
  /** Index of the quickest route. Always present when there is any route. */
  fastest: number | null;
  /** Why there is — or is not — a preferred route. Shown to the reader. */
  reason: string;
}

/**
 * Rank routes by what the map says about them.
 *
 * `assessments[i]` is null while route `i` is still being read, and its
 * `.score` is null when the map said too little to judge it. Both mean "no
 * opinion", and a route with no opinion is never preferred and never counts
 * towards there being something to compare.
 */
export function compareRoutes(
  routes: readonly Route[],
  assessments: readonly (Assessment | null)[],
): Comparison {
  if (routes.length === 0) return { preferred: null, fastest: null, reason: "" };

  let fastest = 0;
  for (let i = 1; i < routes.length; i++) {
    const here = routes[i];
    const best = routes[fastest];
    if (here && best && here.seconds < best.seconds) fastest = i;
  }

  if (routes.length === 1) {
    return { preferred: null, fastest, reason: "Only one route — nothing to compare it with." };
  }

  const scored: { index: number; score: number }[] = [];
  for (let i = 0; i < routes.length; i++) {
    const score = assessments[i]?.score;
    if (typeof score === "number") scored.push({ index: i, score });
  }

  if (scored.length < 2) {
    return {
      preferred: null,
      fastest,
      reason:
        scored.length === 0
          ? "OpenStreetMap says too little about these streets to tell the routes apart."
          : "Only one of these routes has enough map data to judge, so there is nothing to compare it against.",
    };
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const runnerUp = scored[1];
  if (!best || !runnerUp) return { preferred: null, fastest, reason: "" };

  const margin = best.score - runnerUp.score;
  if (margin < MEANINGFUL_MARGIN) {
    return {
      preferred: null,
      fastest,
      reason: `These routes score within ${margin} point${margin === 1 ? "" : "s"} of each other — too close to call one better.`,
    };
  }

  return {
    preferred: best.index,
    fastest,
    /*
     * Says what the number IS, not which factor won: with factors switched off
     * in Layers, "better lit" could be untrue of a route preferred on frontage
     * alone. The Safety tab's table is where the factors are compared.
     *
     * And no "safe", in any construction. "Preferred, not safe" was the first
     * version; the supervisor's objection is to the word itself on the screen,
     * because a reader skims past the "not".
     */
    reason: `It reads ${margin} points better than the next way round on what the map records here. A suggestion, not a guarantee.`,
  };
}
