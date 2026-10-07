/**
 * What is BESIDE a route — and deliberately not in its score.
 *
 * The supervisor's framing of the crime question: one report on a whole map is
 * invisible, but "throughout your path you have these three, and the
 * alternative has five" is a comparison a person can use. So the reports and
 * the places to go near each candidate route are counted here and shown side by
 * side with the score, in the Safety tab and on each route card.
 *
 * ⚠ BESIDE, never INSIDE. `score.ts` is computed from OpenStreetMap alone, and
 * the reasons have not changed (see CLAUDE.md § "The crime layer holds no
 * crime data"): the reports are whatever people chose to enter, a gap in them
 * reads as reassurance, and one keen reporter on one street would move every
 * route through it. Putting the count next to the number lets a person weigh
 * it; folding it into the number would weigh it for them, invisibly. Nothing
 * under `score.ts`, `segments.ts` or `compare.ts` may import this file.
 *
 * Pure. Distances are to the drawn line, so a report on a parallel street a
 * block away is not "on" the route.
 */

import { distanceToPathM } from "./geo.ts";
import type { Spot } from "./layers.ts";
import type { LatLng } from "./osrm.ts";
import type { Report } from "./reports.ts";

/**
 * How close counts as "along the route".
 *
 * Reports are scattered within a district, not pinned to a doorway, so a tight
 * radius would make the count depend on the scatter. 75 m is about one street
 * either side; a place to go is worth a slightly longer detour.
 */
export const REPORT_RADIUS_M = 75;
export const PLACE_RADIUS_M = 100;

export function reportsAlong(path: readonly LatLng[], reports: readonly Report[], radiusM = REPORT_RADIUS_M): Report[] {
  if (path.length < 2) return [];
  const line = [...path];
  return reports.filter((report) => distanceToPathM(report.point, line) <= radiusM);
}

export function placesAlong(path: readonly LatLng[], spots: readonly Spot[], radiusM = PLACE_RADIUS_M): Spot[] {
  if (path.length < 2) return [];
  const line = [...path];
  return spots.filter((spot) => distanceToPathM(spot.point, line) <= radiusM);
}

/**
 * Reports within `window` hours of the hour being planned for, either side,
 * wrapping round midnight. "What happens here at the time I will be here" is
 * the temporal question the supervisor raised; 22:00 and 02:00 are four hours
 * apart, not twenty.
 */
export function aroundHour(reports: readonly Report[], hour: number, window = 3): Report[] {
  return reports.filter((report) => {
    const at = new Date(report.at);
    if (Number.isNaN(at.getTime())) return false;
    const gap = Math.abs(at.getHours() - hour);
    return Math.min(gap, 24 - gap) <= window;
  });
}
