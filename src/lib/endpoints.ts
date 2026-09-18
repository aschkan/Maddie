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
 * has.
 *
 * There is no environment variable here any more, and none anywhere else in the
 * proxy system either. `PUBLIC` below is still the old direct behaviour and
 * `resolve()` still selects it — but the selection is a constant in this file,
 * not something a box can be left in the wrong state for.
 */

/**
 * The services the browser needs, and nothing else.
 *
 * Four of them are the map itself. `cbs` and `pdok` are the police-figures
 * layer — CBS StatLine for the recorded crime and PDOK for the neighbourhood
 * a coordinate is in — and they are here for the same reason as the rest: the
 * machine that cannot reach OpenStreetMap cannot reach those either, and a
 * browser sent straight out from a page it served would get nothing.
 */
export type MapService = "overpass" | "osrm" | "nominatim" | "tile" | "cbs" | "pdok";

/** This server, standing in front of OpenStreetMap. Same origin, always. */
export const FORWARD: Record<MapService, string> = {
  overpass: "/api/osm/overpass",
  osrm: "/api/osm/osrm",
  nominatim: "/api/osm/nominatim",
  tile: "/api/osm/tile/{z}/{x}/{y}.png",
  cbs: "/api/osm/cbs",
  pdok: "/api/osm/pdok",
};

/** Straight from the browser, the way it used to be. */
export const PUBLIC: Record<MapService, string> = {
  overpass: "https://overpass-api.de/api/interpreter",
  osrm: "https://router.project-osrm.org",
  nominatim: "https://nominatim.openstreetmap.org",
  tile: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  cbs: "https://dataderden.cbs.nl/ODataApi/OData",
  pdok: "https://api.pdok.nl/bzk/locatieserver/search/v3_1",
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
 * Where each service is actually pointed, in this build.
 *
 * These were `process.env.NEXT_PUBLIC_*` reads. They are constants now, with
 * the rest of the proxy system, and the reason is the same: this app is built
 * once and deployed to two machines, `NEXT_PUBLIC_*` is inlined at BUILD time
 * rather than read at boot, and a variable that only takes effect on a rebuild
 * is a variable that will one day be set on a box and quietly ignored.
 *
 * `resolve()` above still takes both as arguments and is still the rule, so
 * pointing this at a self-hosted OSRM or Overpass is a one-line edit here.
 */
const EXPLICIT: Record<MapService, string | undefined> = {
  overpass: undefined,
  osrm: undefined,
  nominatim: undefined,
  tile: undefined,
  cbs: undefined,
  pdok: undefined,
};

/**
 * Whether the browser goes straight out instead of through this server.
 *
 * Undefined, meaning no. The forwarder is the whole point: it is what lets one
 * machine reach OpenStreetMap through a rotating pool of exits while the other
 * cannot reach it at all, and it is where a rate limit is noticed and worked
 * around. A browser going direct gets none of that.
 */
const DIRECT: string | undefined = undefined;

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
  return `This server could not reach ${UPSTREAM_NAME[service]} — no route out worked. Check /api/osm/status.`;
}

/**
 * Whose server is at the far end of each service.
 *
 * Named rather than all called "OpenStreetMap", because the sentence above is
 * read by somebody deciding which machine to go and look at, and four of these
 * are OSM's while two are the Dutch government's. Telling them apart is the
 * whole job of that sentence.
 */
const UPSTREAM_NAME: Record<MapService, string> = {
  overpass: "OpenStreetMap",
  osrm: "OpenStreetMap",
  nominatim: "OpenStreetMap",
  tile: "OpenStreetMap",
  cbs: "CBS",
  pdok: "PDOK",
};

/**
 * A 429 from `/api/osm/*`, turned into a sentence for the person on the map.
 *
 * Said plainly and never hidden. The server rotates a rate-limited request
 * through a different exit and only answers 429 once every exit it has has
 * been refused too — so by the time this is read, retrying quietly has already
 * been tried and has already failed, and the honest thing left is to say so.
 * Swallowing it into "could not reach OpenStreetMap" sends whoever is looking
 * at the proxy list, which is working.
 *
 * The body carries how many exits were spent, when the server sent one. It is
 * optional on purpose: a 429 straight from an upstream this app is talking to
 * directly has no such body, and the sentence has to work without it.
 */
export async function rateLimitMessage(response: Response, what: string): Promise<string> {
  let tried = 0;
  try {
    const body = (await response.clone().json()) as { exitsTried?: unknown };
    if (typeof body?.exitsTried === "number" && body.exitsTried > 1) tried = body.exitsTried;
  } catch {
    // No JSON body, or not ours. The sentence below stands on its own.
  }
  const spent = tried > 0 ? ` We tried ${tried} different exits and each was refused.` : "";
  return `We have reached OpenStreetMap's rate limit for ${what}.${spent} Wait about a minute and try again.`;
}

/** The same thing, for a request that never got an answer at all. */
export function unreachableMessage(service: MapService, what: string): string {
  return isForwarded(service)
    ? `Could not reach this server to ask for ${what}.`
    : `Could not reach ${what} from this browser.`;
}
