/**
 * Handing the walk to Google Maps, without handing over the route.
 *
 * The point of this app is which way round to walk. The point of a phone's
 * navigation app is everything after that: spoken directions, rerouting when
 * you miss a turn, a lock screen, a battery budget somebody else optimised.
 * Those are not things worth rebuilding, and a person walking home at night is
 * better served by the app they already know how to use.
 *
 * So the handoff has one job, and it is not "open Google Maps at my
 * destination" — that would throw away the entire contribution. Google would
 * plan its own route, which is the fastest one, which is the one Maddie exists
 * to disagree with. **The route has to survive the handoff.**
 *
 * It survives as WAYPOINTS. Google's URL scheme takes intermediate points and
 * routes through them in order, so a handful of well-placed ones pin its route
 * onto ours. The honest limits of that are written on `MAX_WAYPOINTS` and
 * `simplify` below, and they are real: this is our route approximated, not our
 * route reproduced.
 *
 * ⚠ It leaves the app, and it leaves it for Google. Everything Maddie knows
 * about the walk — the lit stretches, the stretch worth taking care on — stops
 * at the door. `NavPanel` says so before the tap, because somebody choosing
 * this should know what they are trading away.
 */

import { distanceM, pathLengthM } from "./geo.ts";
import type { LatLng, Profile } from "./osrm.ts";

/**
 * How many intermediate points Google's URL scheme accepts.
 *
 * Nine. Not a number to tune: it is the documented ceiling of the Maps URLs
 * API, and going over it does not degrade — the link is rejected and the
 * navigation does not start at all.
 */
export const MAX_WAYPOINTS = 9;

/** Google's own name for each way of travelling. */
const TRAVEL_MODE: Record<Profile, string> = {
  driving: "driving",
  walking: "walking",
  cycling: "bicycling",
};

/** Six decimals is a tenth of a metre — more is noise and a longer URL. */
function coord(point: LatLng): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

/**
 * Reduce a route to the few points that hold its shape.
 *
 * Ramer–Douglas–Peucker, not every-nth-point. Even spacing spends its budget on
 * the long straight sections, where Google would have gone the same way
 * unprompted, and has nothing left for the one corner where our route and the
 * fast route part company — which is the only place a waypoint does any work.
 * RDP keeps the points that carry the most shape, which are exactly those
 * corners.
 *
 * The tolerance is searched rather than fixed, because the budget is a COUNT
 * and RDP takes a distance. A tolerance that leaves twelve points on a city
 * route leaves three on a long one.
 */
export function simplify(path: readonly LatLng[], limit: number = MAX_WAYPOINTS): LatLng[] {
  if (path.length <= 2) return [];
  const inner = path.slice(1, -1);
  if (inner.length <= limit) return [...inner];

  const total = pathLengthM(path);
  let low = 1;
  let high = Math.max(total, 100);
  let best: LatLng[] = [];

  // Twenty halvings takes the bracket to well under a metre, which is finer
  // than the coordinates are printed at.
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2;
    const kept = rdp(path, mid).slice(1, -1);
    if (kept.length > limit) low = mid;
    else { best = kept; high = mid; }
  }
  return best.slice(0, limit);
}

/** Ramer–Douglas–Peucker, keeping the ends. */
function rdp(path: readonly LatLng[], toleranceM: number): LatLng[] {
  if (path.length < 3) return [...path];
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return [...path];

  let worst = 0;
  let at = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const point = path[i];
    if (!point) continue;
    const away = perpendicularM(point, first, last);
    if (away > worst) { worst = away; at = i; }
  }

  if (worst <= toleranceM) return [first, last];
  return [
    ...rdp(path.slice(0, at + 1), toleranceM).slice(0, -1),
    ...rdp(path.slice(at), toleranceM),
  ];
}

/** Distance from a point to the line through a and b — not to the segment. */
function perpendicularM(point: LatLng, a: LatLng, b: LatLng): number {
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const px = point.lng * scale, py = point.lat;
  const ax = a.lng * scale, ay = a.lat;
  const bx = b.lng * scale, by = b.lat;
  const dx = bx - ax, dy = by - ay;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return distanceM(point, a);
  const t = ((px - ax) * dx + (py - ay) * dy) / (length * length);
  const on = { lat: ay + t * dy, lng: (ax + t * dx) / scale };
  return distanceM(point, on);
}

export interface Handoff {
  url: string;
  /** How many of our points made it into the link. */
  waypoints: number;
  /**
   * The worst distance, in metres, between our route and the straight lines
   * between the waypoints Google was given.
   *
   * An honest measure of how much shape was lost. It is NOT how far Google's
   * route will stray — Google follows streets between waypoints, so it is
   * usually far closer than this — but it is the bound we can actually state,
   * and stating a bound beats implying there is none.
   */
  driftM: number;
}

/**
 * A Google Maps link that follows OUR route, as closely as nine points allow.
 *
 * `dir_action=navigate` starts turn-by-turn rather than showing a preview, on
 * the app if it is installed and in the browser otherwise.
 */
export function googleMapsLink(path: readonly LatLng[], profile: Profile): Handoff | null {
  if (path.length < 2) return null;
  const from = path[0];
  const to = path[path.length - 1];
  if (!from || !to) return null;

  const via = simplify(path);
  const query = new URLSearchParams({
    api: "1",
    origin: coord(from),
    destination: coord(to),
    travelmode: TRAVEL_MODE[profile],
    dir_action: "navigate",
  });
  // Built separately: the separator between waypoints is a literal `|`, and
  // URLSearchParams would percent-encode it into something Google ignores.
  const waypoints = via.map(coord).join("|");
  const tail = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "";

  return {
    url: `https://www.google.com/maps/dir/?${query}${tail}`,
    waypoints: via.length,
    driftM: Math.round(driftOf(path, [from, ...via, to])),
  };
}

/** The worst distance from our route to the polyline through the waypoints. */
function driftOf(path: readonly LatLng[], through: readonly LatLng[]): number {
  let worst = 0;
  for (const point of path) {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < through.length; i++) {
      const a = through[i - 1];
      const b = through[i];
      if (!a || !b) continue;
      const away = segmentM(point, a, b);
      if (away < best) best = away;
    }
    if (best > worst) worst = best;
  }
  return worst;
}

/** Distance to a segment, ends included. */
function segmentM(point: LatLng, a: LatLng, b: LatLng): number {
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const px = point.lng * scale, py = point.lat;
  const ax = a.lng * scale, ay = a.lat;
  const bx = b.lng * scale, by = b.lat;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return distanceM(point, { lat: ay + t * dy, lng: (ax + t * dx) / scale });
}
