/**
 * Which upstreams this server will forward to, and how.
 *
 * Split out from the route so it can be tested: the table below is the only
 * thing standing between "a same-origin path that fetches OpenStreetMap" and
 * an open proxy, which on somebody's public server is a problem within the
 * day. A target that can be named by the request is not a forwarder.
 */

export interface Service {
  /**
   * Where it goes. Nothing in the request may change this.
   *
   * A list, because a rate limit is per exit IP PER MIRROR: changing both on a
   * retry is two independent chances of an answer, and Overpass in particular
   * has several mirrors that serve the same data.
   */
  bases: string[];
  methods: ("GET" | "POST")[];
  /** Cache-Control for the browser. Tiles are the only thing worth caching. */
  cache: string;
  /**
   * How long this server remembers a reply, in ms. 0 never caches.
   *
   * This is the lever that actually gets under a rate limit: an answer served
   * from memory is a request that was never made. The values are what the
   * underlying data is worth — street lighting does not change in ten minutes,
   * a tile does not change in a week, and an address search for the same three
   * words has the same answer all day.
   */
  ttlMs: number;
  /** Rewrite the tail of the path onto the upstream. */
  suffix?: (parts: string[]) => string;
}

export const SERVICES: Record<string, Service> = {
  overpass: {
    bases: [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.osm.ch/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ],
    methods: ["POST", "GET"],
    cache: "no-store",
    // Ten minutes. The layer query re-runs on every pan that settles, and
    // panning back to where you were is the commonest thing anyone does on a
    // map — that was a fresh query to a rate-limited service every time.
    ttlMs: 600_000,
    // The client posts to the base itself, so anything after it is ignored.
    suffix: () => "",
  },
  osrm: {
    bases: ["https://router.project-osrm.org"],
    methods: ["GET"],
    cache: "no-store",
    // A route between two fixed points does not change while you move the hour
    // slider, and dragging a pin back returns to a pair already asked for.
    ttlMs: 600_000,
  },
  nominatim: {
    bases: ["https://nominatim.openstreetmap.org"],
    methods: ["GET"],
    cache: "no-store",
    // Typing an address, deleting a character and retyping it asks the same
    // question three times. Nominatim's policy is one request a second.
    ttlMs: 3_600_000,
  },
  tile: {
    bases: [
      "https://tile.openstreetmap.org",
      "https://a.tile.openstreetmap.org",
      "https://b.tile.openstreetmap.org",
      "https://c.tile.openstreetmap.org",
    ],
    methods: ["GET"],
    // A tile never changes for a week, and re-fetching one through two proxies
    // is the most expensive way to redraw a pan.
    cache: "public, max-age=604800, immutable",
    // The browser cache covers one visitor; this covers all of them, and
    // tiles are the bulk of what goes out.
    ttlMs: 604_800_000,
  },
};

/**
 * What RFC 3986 allows in a path segment without encoding.
 *
 * `pchar`: unreserved, sub-delims, `:` and `@`. The sub-delims are the point —
 * OSRM takes its coordinates as ONE segment, `lon,lat;lon,lat`, and parses that
 * segment itself rather than letting a URL library decode it first. Running it
 * through `encodeURIComponent` gives `4.89%2C52.37%3B4.90%2C52.38`, which OSRM
 * reads literally and refuses with a 400 — so forwarded routing failed while
 * forwarded tiles and search worked, which looks like "routing is broken"
 * rather than like an encoding bug.
 */
const PCHAR = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]*$/;

/**
 * Encode a path segment, leaving alone anything that never needed encoding.
 *
 * Next has already decoded these, so a segment holding a literal `%` or a space
 * is encoded whole; everything a map service actually sends passes through
 * byte for byte.
 */
function safeSegment(part: string): string {
  return PCHAR.test(part) ? part : encodeURIComponent(part);
}

/**
 * Build the upstream URL. Pure, and the only place a request influences it.
 *
 * Every path segment is checked: `..` climbing out of the service's base would
 * turn this into a forwarder for the rest of the host.
 */
export function upstreamUrl(service: Service, parts: string[], search: string, attempt = 0): string | null {
  for (const part of parts) {
    if (part === "." || part === ".." || part.includes("\\") || part.includes("//")) return null;
  }
  const base = service.bases[attempt % service.bases.length];
  if (!base) return null;
  const tail = service.suffix ? service.suffix(parts) : parts.map(safeSegment).join("/");
  const path = tail ? `/${tail}` : "";
  return `${base.replace(/\/+$/, "")}${path}${search}`;
}

/**
 * What to tell the client when nothing came back, in one testable place.
 *
 * The distinction it exists to keep: **rate limited** is temporary, is nobody's
 * fault and has an action attached (wait a minute); **unreachable** says this
 * server could not get out at all and sends whoever reads it to check the
 * network and the proxy list. Answering the second when the first is true is a
 * shipped bug, not a wording preference — it was reported as "This server could
 * not reach OpenStreetMap — no route out worked" on a box whose network was
 * fine, sitting above a route the same page had just finished scoring.
 *
 * How it happened: the route read goes out as several simultaneous requests,
 * all of them direct on a server that can reach OpenStreetMap. Overpass refused
 * the later ones with 429. The pool of public proxies had no working exit, so
 * `rotate()` returned having tried nothing at all — `limited: false`, because
 * nothing was tried — and the 429 the DIRECT attempt had seen was thrown away.
 *
 * So all three sources count, and any of them saying 429 makes it a rate limit.
 */
export function nothingWorked(seen: {
  /** `rotate()` saw at least one exit refused with 429. */
  rotationLimited: boolean;
  /** What the direct-first attempt answered, if it was made and answered. */
  directStatus: number | null;
  /** What the direct retry at the end answered, if it was made and answered. */
  fallbackStatus: number | null;
}): "rate-limited" | "unreachable" {
  if (seen.rotationLimited) return "rate-limited";
  if (seen.directStatus === 429 || seen.fallbackStatus === 429) return "rate-limited";
  return "unreachable";
}

/** Status codes worth asking a different exit about. */
export function shouldRotate(status: number): boolean {
  // 429 rate limited, 403 some proxies inject, 5xx upstream or gateway.
  // NOT 4xx generally: a 400 means the query is wrong, and asking the same
  // wrong question from every proxy in turn burns a slot on each of them.
  return status === 429 || status === 403 || status === 408 || status >= 500;
}
