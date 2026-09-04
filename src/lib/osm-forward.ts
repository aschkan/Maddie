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
  /** Rewrite the tail of the path onto the upstream. */
  suffix?: (parts: string[]) => string;
}

/** A comma-separated env override, or the built-in list. */
function bases(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const list = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  return list.length > 0 ? list : fallback;
}

export const SERVICES: Record<string, Service> = {
  overpass: {
    bases: bases("OSM_UPSTREAM_OVERPASS", [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.osm.ch/api/interpreter",
    ]),
    methods: ["POST", "GET"],
    cache: "no-store",
    // The client posts to the base itself, so anything after it is ignored.
    suffix: () => "",
  },
  osrm: {
    bases: bases("OSM_UPSTREAM_OSRM", ["https://router.project-osrm.org"]),
    methods: ["GET"],
    cache: "no-store",
  },
  nominatim: {
    bases: bases("OSM_UPSTREAM_NOMINATIM", ["https://nominatim.openstreetmap.org"]),
    methods: ["GET"],
    cache: "no-store",
  },
  tile: {
    bases: bases("OSM_UPSTREAM_TILE", [
      "https://tile.openstreetmap.org",
      "https://a.tile.openstreetmap.org",
      "https://b.tile.openstreetmap.org",
    ]),
    methods: ["GET"],
    // A tile never changes for a week, and re-fetching one through two proxies
    // is the most expensive way to redraw a pan.
    cache: "public, max-age=604800, immutable",
  },
};

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
  const tail = service.suffix ? service.suffix(parts) : parts.map(encodeURIComponent).join("/");
  const path = tail ? `/${tail}` : "";
  return `${base.replace(/\/+$/, "")}${path}${search}`;
}

/** Status codes worth asking a different exit about. */
export function shouldRotate(status: number): boolean {
  // 429 rate limited, 403 some proxies inject, 5xx upstream or gateway.
  // NOT 4xx generally: a 400 means the query is wrong, and asking the same
  // wrong question from every proxy in turn burns a slot on each of them.
  return status === 429 || status === 403 || status === 408 || status >= 500;
}
