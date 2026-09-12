/**
 * Routing against an OSRM server.
 *
 * OSRM is the routing engine behind the OpenStreetMap website's own directions,
 * and `router.project-osrm.org` is the project's public demo server. It needs no
 * key. It is also a demo — rate limited, occasionally down, and offered with no
 * uptime promise — so `OSRM_URL` points somewhere else the moment this matters.
 */

import { endpoint, forwarderFailure, unreachableMessage } from "./endpoints.ts";

/** A point the way Leaflet says it: latitude first. */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface Route {
  /** The line to draw, already in Leaflet's lat/lng order. */
  path: LatLng[];
  metres: number;
  seconds: number;
}

/**
 * The OSRM server to ask — this server's forwarder by default.
 *
 * `NEXT_PUBLIC_OSRM_URL` overrides it and is the right answer for a real
 * deployment, which should be pointing at its own OSRM. It has to carry the
 * `NEXT_PUBLIC_` prefix because the browser makes this request, so the value is
 * inlined at build time; a server-only variable arrives here as `undefined` and
 * falls back without saying so.
 */
export const DEFAULT_OSRM = endpoint("osrm");

/**
 * Profiles the public demo server actually answers for.
 *
 * `driving` is the one it is guaranteed to serve; the foot and bike profiles
 * have come and gone on that host over the years. They are offered here because
 * a self-hosted OSRM built with those profiles serves them fine, and this app is
 * meant to be pointed at one — but a 400 from the demo server is not a bug in
 * this code.
 */
export const PROFILES = ["driving", "walking", "cycling"] as const;
export type Profile = (typeof PROFILES)[number];

/** OSRM's own name for each profile. `walking`/`cycling` are our labels. */
const OSRM_PROFILE: Record<Profile, string> = {
  driving: "driving",
  walking: "foot",
  cycling: "bike",
};

/**
 * Build the request URL.
 *
 * ⚠ OSRM takes coordinates as **lon,lat** — GeoJSON order — and Leaflet uses
 * lat,lng. Swapping them is the single easiest mistake to make here, and it
 * fails quietly: you get a route, just one on the other side of the world.
 * Amsterdam (52.37, 4.89) sent the wrong way round lands in Somalia.
 */
export function routeUrl(
  from: LatLng,
  to: LatLng,
  profile: Profile = "driving",
  base: string = DEFAULT_OSRM,
): string {
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const query = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    // Ask for other ways round. There is nothing to compare otherwise, and
    // OSRM often returns only one anyway — a straight road has no alternative.
    alternatives: "3",
  });
  return `${base.replace(/\/+$/, "")}/route/v1/${OSRM_PROFILE[profile]}/${coords}?${query}`;
}

/** The bits of OSRM's reply this app reads. Everything else is ignored. */
interface OsrmReply {
  code?: string;
  message?: string;
  routes?: {
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: unknown };
  }[];
}

/**
 * OSRM's answer → a route, or a reason there isn't one.
 *
 * Separate from the fetch so the shape handling is testable without a network,
 * which matters because the demo server cannot be reached from every machine
 * this is developed on.
 */
export function parseRoutes(reply: unknown): { ok: true; routes: Route[] } | { ok: false; error: string } {
  const body = reply as OsrmReply | null;
  if (!body || typeof body !== "object") return { ok: false, error: "The routing service sent something unreadable." };

  // OSRM reports failure in the body with a 200, so the status code alone
  // never tells you whether there is a route.
  if (body.code && body.code !== "Ok") {
    if (body.code === "NoRoute") {
      return { ok: false, error: "No route between those two points — try moving one nearer a road." };
    }
    return { ok: false, error: body.message ?? `The routing service said: ${body.code}` };
  }

  const routes: Route[] = [];
  for (const candidate of body.routes ?? []) {
    const coordinates = candidate?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;

    const path: LatLng[] = [];
    for (const pair of coordinates) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [lng, lat] = pair as [unknown, unknown];   // lon first: GeoJSON order
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      path.push({ lat, lng });
    }
    if (path.length < 2) continue;

    routes.push({
      path,
      metres: typeof candidate?.distance === "number" ? candidate.distance : 0,
      seconds: typeof candidate?.duration === "number" ? candidate.duration : 0,
    });
  }

  if (routes.length === 0) {
    return { ok: false, error: "The routing service returned no line to draw." };
  }
  return { ok: true, routes };
}

/**
 * An HTTP failure, in words.
 *
 * The 400 matters: the public demo server has not consistently carried the foot
 * and bike profiles, so "walk" and "cycle" can fail there while "drive" works.
 * That looks like a broken app rather than a limit of a free demo server, so it
 * says which it is and what to do about it.
 */
function describeStatus(status: number, profile: Profile): string {
  const ours = forwarderFailure("osrm", status);
  if (ours) return ours;
  if (status === 429) return "The public routing server is rate limiting us. Wait a moment and try again.";
  if (status === 400 && profile !== "driving") {
    return `The routing server would not plan a ${profile === "walking" ? "walking" : "cycling"} route. ` +
      "The public demo server does not always carry that profile — try Drive, or point OSRM_URL at your own server.";
  }
  if (status >= 500) return "The routing server is having trouble. Try again in a moment.";
  return `The routing service answered ${status}.`;
}

/** Fetch a route. Never throws — the caller gets a message it can show. */
export async function fetchRoutes(
  from: LatLng,
  to: LatLng,
  profile: Profile = "driving",
  options: { base?: string; signal?: AbortSignal } = {},
): Promise<{ ok: true; routes: Route[] } | { ok: false; error: string }> {
  const url = routeUrl(from, to, profile, options.base ?? DEFAULT_OSRM);
  let reply: unknown;
  try {
    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) {
      return { ok: false, error: describeStatus(response.status, profile) };
    }
    reply = await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "cancelled" };
    }
    return { ok: false, error: unreachableMessage("osrm", "the routing service") };
  }
  return parseRoutes(reply);
}
