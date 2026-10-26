/**
 * Which upstreams this server will forward to, and how.
 *
 * Split out from the route so it can be tested: the table below is the only
 * thing standing between "a same-origin path that fetches OpenStreetMap" and
 * an open proxy, which on somebody's public server is a problem within the
 * day. A target that can be named by the request is not a forwarder.
 */

/**
 * A region as a polygon of `[lat, lng]` corners — never a rectangle.
 *
 * The first version was a box from 50.7°N to 53.7°N, 3.2°E to 7.3°E, which
 * looks like "the Netherlands" and contains Brussels, Antwerp and most of
 * Flanders. A test asking about Brussels caught it.
 */
export type Coverage = readonly (readonly [number, number])[];

/**
 * Our OWN Overpass, on loopback, holding one region.
 *
 * It is asked FIRST, before the cache misses go anywhere public: no rate
 * limit, no proxy, a second rather than twenty-five. But it holds ONE REGION,
 * and a regional Overpass asked about somewhere else answers 200 with an empty
 * list — the exact failure `overpass.osm.ch` caused in the public rotation. So
 * it is only ever asked a query whose every coordinate is inside `covers`
 * (`queryWithin`), and anything it cannot answer falls through to the public
 * path unchanged.
 *
 * On a machine with no local Overpass the base refuses the connection in about
 * a millisecond, and that is the whole cost.
 */
export interface LocalUpstream {
  base: string;
  covers: Coverage;
  timeoutMs: number;
}

/**
 * The Netherlands, drawn deliberately INSIDE its border.
 *
 * The two ways of being wrong cost different things. A Dutch point left
 * outside this line is asked of the public servers, exactly as before — a
 * slower answer, never a wrong one. A Belgian or German point drawn inside it
 * would be asked of our copy, which does not hold it, and the empty reply
 * would read as "nobody has mapped this". So the line keeps clear of every
 * land border: south Limburg, Zeeuws-Vlaanderen, Baarle-Nassau's enclaves and
 * the strip along the German border go to the public servers. Utrecht, the
 * study's whole area, is far inside it.
 */
export const NETHERLANDS: Coverage = [
  [52.95, 4.65], [53.15, 4.85], [53.40, 6.20], [53.32, 6.90], [53.15, 7.05],
  [52.65, 6.95], [52.22, 6.92], [51.95, 6.62], [51.85, 5.95], [51.55, 5.95],
  [51.45, 5.85], [51.50, 4.95], [51.50, 4.40], [51.55, 3.80], [51.55, 3.45],
  [51.95, 4.05], [52.45, 4.55],
];

/** Ray casting: is the point inside the polygon? */
function inside(lat: number, lng: number, polygon: Coverage): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i] as readonly [number, number];
    const [latJ, lngJ] = polygon[j] as readonly [number, number];
    if ((lngI > lng) !== (lngJ > lng) && lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI) hit = !hit;
  }
  return hit;
}

/**
 * Whether every coordinate an Overpass query names lies inside `region`.
 *
 * The queries this app sends name places in two ways — a bounding box
 * `(south,west,north,east)` for the layers, and `around:R,lat,lon,lat,lon…`
 * along a route — and both are latitude, longitude pairs once the decimals are
 * read in order. Radii, timeouts and output caps are whole numbers, so they are
 * not mistaken for coordinates. No coordinate at all, or an odd count, is NOT
 * within anything: the answer must be yes only when it is certainly yes.
 *
 * Checking a bounding box's two corners is enough here because the region is
 * drawn well inside the border: a box whose corners are both inside it is
 * inside the country.
 */
export function queryWithin(body: string, region: Coverage): boolean {
  let text = body;
  try {
    const form = new URLSearchParams(body);
    text = form.get("data") ?? body;
  } catch {
    // Not a form; read it as written.
  }
  const numbers = [...text.matchAll(/-?\d{1,3}\.\d+/g)].map((match) => Number(match[0]));
  if (numbers.length < 2 || numbers.length % 2 !== 0) return false;
  for (let i = 0; i < numbers.length; i += 2) {
    if (!inside(numbers[i] as number, numbers[i + 1] as number, region)) return false;
  }
  return true;
}

/* ── the study PC: tiles, routing and search, self-hosted ─────────────── */

/**
 * Tiles, routing and search for the Netherlands, self-hosted on the study PC
 * (Docker: tileserver-gl, three OSRM profiles, Nominatim — `scripts/osm-pc/`).
 *
 * The PC sits on aschkan's LAN, so BOTH servers reach it the same way: through
 * aschkan's WireGuard address, where `scripts/osm-pc/relay.js` forwards each
 * port to the PC. One address, the same constant on both boxes — parsa
 * crosses the tunnel, aschkan talks to its own interface.
 *
 * Asked FIRST and only about what it holds — a tile wholly inside
 * `NETHERLANDS`, a route whose every point is inside, a search that comes back
 * with something — and when the PC is off, asleep or busy the request goes to
 * the public servers exactly as before. A PC that failed is not asked again
 * for a minute (`PC_RETRY_MS`), so a switched-off PC costs one short timeout a
 * minute, not one per tile.
 */
export const PC_RELAY = "http://10.8.0.2";
export const PC_PORTS = { tile: 18180, nominatim: 18188, foot: 18101, bike: 18102, driving: 18103 } as const;
/** The tileserver-gl style the PC renders. */
export const PC_TILE_STYLE = "maddie";
/** Below this a tile spans much more than the country; the public tiles draw it. */
export const PC_MIN_TILE_ZOOM = 7;
export const PC_RETRY_MS = 60_000;

export interface PcTarget {
  url: string;
  timeoutMs: number;
  /** A search that comes back empty is not an answer from a one-country index. */
  needsResults?: boolean;
}

/** The tile's corners, as [lat, lng]. Standard slippy-map maths. */
export function tileCorners(z: number, x: number, y: number): [number, number][] {
  const n = 2 ** z;
  const lng = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [[lat(y), lng(x)], [lat(y), lng(x + 1)], [lat(y + 1), lng(x)], [lat(y + 1), lng(x + 1)]];
}

/**
 * Where on the PC this request can be answered, or null for "ask the public
 * servers". Pure: the route decides whether the PC is up.
 */
export function pcTarget(name: string, parts: readonly string[], search: string): PcTarget | null {
  if (name === "tile") {
    const [zs, xs, file] = parts;
    const ys = file?.replace(/\.png$/, "");
    const [z, x, y] = [Number(zs), Number(xs), Number(ys)];
    if (![z, x, y].every(Number.isInteger) || z < PC_MIN_TILE_ZOOM || z > 20 || parts.length !== 3) return null;
    if (!tileCorners(z, x, y).every(([lat, lng]) => inside(lat, lng, NETHERLANDS))) return null;
    return { url: `${PC_RELAY}:${PC_PORTS.tile}/styles/${PC_TILE_STYLE}/${z}/${x}/${y}.png`, timeoutMs: 8_000 };
  }

  if (name === "osrm") {
    const [kind, version, profile, coords] = parts;
    if (kind !== "route" || version !== "v1" || !coords || parts.length !== 4) return null;
    const port = profile === "driving" ? PC_PORTS.driving : profile === "foot" ? PC_PORTS.foot : profile === "bike" ? PC_PORTS.bike : null;
    if (!port) return null;
    // OSRM is lon,lat; `inside` takes lat,lng.
    const points = coords.split(";").map((pair) => pair.split(",").map(Number));
    if (points.length < 2 || !points.every((p) => p.length === 2 && p.every(Number.isFinite) && inside(p[1]!, p[0]!, NETHERLANDS))) return null;
    return { url: `${PC_RELAY}:${port}/route/v1/${profile}/${coords}${search}`, timeoutMs: 20_000 };
  }

  if (name === "nominatim") {
    if (parts.length !== 1) return null;
    if (parts[0] === "search") return { url: `${PC_RELAY}:${PC_PORTS.nominatim}/search${search}`, timeoutMs: 8_000, needsResults: true };
    if (parts[0] === "reverse") {
      const query = new URLSearchParams(search);
      const lat = Number(query.get("lat"));
      const lon = Number(query.get("lon"));
      if (!query.has("lat") || !Number.isFinite(lat) || !Number.isFinite(lon) || !inside(lat, lon, NETHERLANDS)) return null;
      return { url: `${PC_RELAY}:${PC_PORTS.nominatim}/reverse${search}`, timeoutMs: 8_000 };
    }
  }
  return null;
}

/** Does a search reply hold at least one place? Anything unreadable is "no". */
export function hasResults(payload: string): boolean {
  try {
    const value = JSON.parse(payload) as unknown;
    return Array.isArray(value) ? value.length > 0 : !!value && typeof value === "object" && !("error" in value);
  } catch {
    return false;
  }
}

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
  /** Our own copy, asked first for queries it covers. See `LocalUpstream`. */
  local?: LocalUpstream;
}

export const SERVICES: Record<string, Service> = {
  overpass: {
    bases: [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      /*
       * NOT `overpass.osm.ch`, which was here. It holds SWITZERLAND ONLY, and a
       * Dutch query sent to it is answered 200 with a well-formed, EMPTY list —
       * no ways, no lamps, no places. Nothing errors; the forwarder caches it
       * for ten minutes; the route reads as "nobody has mapped this" and the
       * layers as "nothing here", both false claims about OpenStreetMap that
       * the rotation hands out to whichever request lands on that mirror.
       * Found recording the Utrecht scenario: a probe of the live forwarder
       * came back empty with that instance's own `timestamp_osm_base`.
       * Only WORLD instances belong in this list; `test/overpass-mirrors.test.ts`.
       */
    ],
    methods: ["POST", "GET"],
    cache: "no-store",
    // Ten minutes. The layer query re-runs on every pan that settles, and
    // panning back to where you were is the commonest thing anyone does on a
    // map — that was a fresh query to a rate-limited service every time.
    ttlMs: 600_000,
    // The client posts to the base itself, so anything after it is ignored.
    suffix: () => "",
    // aschkan's own Overpass — the Netherlands, imported from Geofabrik and
    // updated daily (`/srv/overpass`). Loopback only.
    local: {
      base: "http://127.0.0.1:12345/api/interpreter",
      covers: NETHERLANDS,
      timeoutMs: 60_000,
    },
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
  /*
   * Vector tiles, for the navigation view only.
   *
   * MapLibre needs vector tiles to tilt and rotate; the raster tiles the rest
   * of the app uses are flat pictures and cannot be. OpenFreeMap serves them
   * free with no key, no signup and no request limit — which is the same deal
   * every other upstream here is on, and the reason it was picked over the
   * providers that want an API key.
   *
   * ONE service for the whole host, because a MapLibre style pulls four
   * different shapes of thing from it — the style JSON, the tile PBFs, the
   * glyph ranges for labels and the sprite sheet for icons. They share a host,
   * so they share an entry, and the catch-all path handles the rest.
   *
   * ⚠ The style JSON contains ABSOLUTE URLs back to this host. Handing it to
   * MapLibre unmodified would send the browser straight to OpenFreeMap for
   * everything except the style itself, which is exactly the bypass this
   * forwarder exists to prevent — and would blank the map on the machine that
   * cannot reach the internet. `rewriteStyle` in `vector.ts` is what stops it.
   */
  vector: {
    bases: ["https://tiles.openfreemap.org"],
    methods: ["GET"],
    // Same reasoning as the raster tiles: they do not change, and a vector tile
    // re-fetched through two proxies is the most expensive way to redraw a pan.
    cache: "public, max-age=604800, immutable",
    ttlMs: 604_800_000,
  },
  /*
   * CBS StatLine — the police-recorded crime figures. See `nl-crime.ts`.
   *
   * Forwarded for exactly the same reason as everything else here: one of the
   * two machines this is deployed on cannot reach the internet at all, and a
   * browser sent straight to CBS from a page that box served gets nothing.
   *
   * GET only. It is a read-only open-data API and there is nothing to post to
   * it — and a forwarder that accepts POST to a host is a forwarder that can be
   * asked to do more than read.
   */
  cbs: {
    bases: ["https://dataderden.cbs.nl/ODataApi/OData"],
    methods: ["GET"],
    cache: "no-store",
    /*
     * An hour. These are MONTHLY figures with a reporting lag measured in
     * weeks — the answer is the same all day — and the layer re-asks on every
     * pan that lands in a new grid cell. Caching for less would spend requests
     * re-fetching a number that cannot have changed.
     *
     * Not longer, because the shape and the label list are fetched through the
     * same entry, and a stale column list outlives a table revision.
     */
    ttlMs: 3_600_000,
  },
  /*
   * PDOK Locatieserver — the point → CBS neighbourhood join. See `nl-areas.ts`.
   *
   * The reverse lookup is what makes the figures placeable at all, and it is
   * the Dutch government's own service over its own address register.
   */
  pdok: {
    bases: ["https://api.pdok.nl/bzk/locatieserver/search/v3_1"],
    methods: ["GET"],
    cache: "no-store",
    // A day. Neighbourhood boundaries are redrawn once a year at most, and the
    // nine probes per view are the same nine on every return to that view.
    ttlMs: 86_400_000,
  },
  /*
   * PDOK's CBS wijkenbuurten WFS — the neighbourhood BOUNDARIES.
   *
   * A different host from `pdok` (that is the Locatieserver, which answers
   * "which neighbourhood is this point in?"; this one answers "what shape is
   * it?"), so it is a separate entry. Together they are what lets the police
   * figures be drawn over the area they are actually about instead of at a
   * single point in the middle of it.
   *
   * Queried by `buurtcode` through a CQL filter rather than by bbox, and that
   * is deliberate: a WFS 2.0 bbox in EPSG:4326 takes its corners in LAT,LON
   * order, GeoJSON output emits LON,LAT, and getting either backwards returns
   * a plausible-looking polygon in the wrong hemisphere. Filtering by the
   * codes we already hold removes the question from the request entirely, and
   * `parseBoundaries` sanity-checks the reply's own axis order.
   */
  pdokwfs: {
    bases: ["https://service.pdok.nl/cbs/wijkenbuurten/2023/wfs/v1_0"],
    methods: ["GET"],
    cache: "no-store",
    // A week. CBS redraws these once a year at most, and a polygon is far and
    // away the heaviest thing this forwarder fetches per neighbourhood.
    ttlMs: 604_800_000,
    // The client asks the base itself with everything in the query string, so
    // anything after it is ignored.
    suffix: () => "",
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
