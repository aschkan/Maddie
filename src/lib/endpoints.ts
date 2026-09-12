/**
 * Where the BROWSER asks for tiles, routing, search and Overpass.
 *
 * It asks THIS SERVER, at `/api/osm/*`, and the server goes out — directly if
 * it can, and otherwise through the entry proxy and the fastest working exit in
 * the pool. That is the default now, and the reason is that the domain answers
 * from more than one machine:
 *
 *   * one box can reach the internet; the other cannot reach it at all;
 *   * the same build is deployed to both;
 *   * the visitor may be on a network that reaches neither.
 *
 * Sending the browser straight to `tile.openstreetmap.org` works on exactly one
 * of those combinations. Sending it to this server works on all of them,
 * because the server is the one thing that is definitely reachable — the page
 * came from it — and the proxy chain is already the answer to "this box cannot
 * reach OpenStreetMap". It is the same code path whichever machine answered, so
 * the two servers stop behaving differently.
 *
 * ⚠ THIS APP'S OWN API IS NEVER FORWARDED. `/api/assess` and `/api/reports` are
 * same-origin requests to the server that served the page, and they must stay
 * that way: they are not OpenStreetMap, there is nothing to reach around, and
 * putting a proxy chain in front of a loopback call adds two hops and a pool of
 * failure modes to something that cannot fail that way. `SERVICES` in
 * `osm-forward.ts` is a fixed table and holds neither of them, so `/api/osm/`
 * cannot be pointed at either one; `OWN_API` below says the same thing from
 * this side, and `test/endpoints.test.ts` pins that the two never overlap.
 *
 * The cost, stated plainly: every tile now passes through this server. Tiles
 * are cached for a week by the forwarder, the page is one map rather than a
 * tile-serving business, and a blank basemap is the worst failure this page
 * has. `NEXT_PUBLIC_OSM_DIRECT=1` returns to the old behaviour for a
 * deployment that would rather the browser went out on its own.
 */

/** The four services the browser needs, and nothing else. */
export type MapService = "overpass" | "osrm" | "nominatim" | "tile";

/** This server, standing in front of OpenStreetMap. Same origin, always. */
export const FORWARD: Record<MapService, string> = {
  overpass: "/api/osm/overpass",
  osrm: "/api/osm/osrm",
  nominatim: "/api/osm/nominatim",
  tile: "/api/osm/tile/{z}/{x}/{y}.png",
};

/** Straight from the browser, the way it used to be. */
export const PUBLIC: Record<MapService, string> = {
  overpass: "https://overpass-api.de/api/interpreter",
  osrm: "https://router.project-osrm.org",
  nominatim: "https://nominatim.openstreetmap.org",
  tile: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};

/**
 * This app's own endpoints — served by the same box, never proxied.
 *
 * Listed so the rule can be asserted rather than merely intended.
 */
export const OWN_API = ["/api/assess", "/api/reports", "/api/osm/status"] as const;

function truthy(value: string | undefined): boolean {
  const raw = value?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/**
 * The rule, pure and testable.
 *
 * In order: an explicit URL for this service wins — that is how you point at a
 * self-hosted OSRM or Overpass, which is the right answer for a busy
 * deployment and removes the rate limit and the reachability problem together.
 * Then the direct escape hatch. Then the forwarder, which is the default.
 */
export function resolve(
  service: MapService,
  options: { explicit?: string | undefined; direct?: string | undefined } = {},
): string {
  const named = options.explicit?.trim();
  if (named) return named;
  return truthy(options.direct) ? PUBLIC[service] : FORWARD[service];
}

/*
 * Read statically, one member expression per variable.
 *
 * `process.env.NEXT_PUBLIC_FOO` is substituted TEXTUALLY at build time, so it
 * has to be written out in full. A lookup — `process.env[name]` — is not
 * rewritten and arrives in the browser as undefined, which would silently take
 * every override below with it.
 */
const EXPLICIT: Record<MapService, string | undefined> = {
  overpass: process.env.NEXT_PUBLIC_OVERPASS_URL,
  osrm: process.env.NEXT_PUBLIC_OSRM_URL,
  nominatim: process.env.NEXT_PUBLIC_NOMINATIM_URL,
  tile: process.env.NEXT_PUBLIC_TILE_URL,
};

const DIRECT = process.env.NEXT_PUBLIC_OSM_DIRECT;

/** Where this browser should ask for `service`. */
export function endpoint(service: MapService): string {
  return resolve(service, { explicit: EXPLICIT[service], direct: DIRECT });
}

/** True when the page is going through this server rather than straight out. */
export function isForwarded(service: MapService): boolean {
  return endpoint(service).startsWith("/");
}

/**
 * A 502 from `/api/osm/*` is THIS SERVER saying nothing it tried got out.
 *
 * Worth telling apart from an upstream's own answer. "OpenStreetMap answered
 * 502" sends you to check whether OpenStreetMap is down; the truth is that this
 * box could not reach it, directly or through any proxy in the pool, and
 * `/api/osm/status` says which. Returns null when the status is not ours to
 * explain.
 */
export function forwarderFailure(service: MapService, status: number): string | null {
  if (status !== 502 || !isForwarded(service)) return null;
  return "This server could not reach OpenStreetMap — no route out worked. Check /api/osm/status.";
}

/** The same thing, for a request that never got an answer at all. */
export function unreachableMessage(service: MapService, what: string): string {
  return isForwarded(service)
    ? `Could not reach this server to ask for ${what}.`
    : `Could not reach ${what} from this browser.`;
}
