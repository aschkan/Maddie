/**
 * Which CBS neighbourhood a point is in — the join, and the only reason the
 * police figures can be put on a map at all.
 *
 * CBS publishes recorded crime against `buurtcode` / `wijkcode` /
 * `gemeentecode`, which are codes in the government's own regional breakdown
 * and appear in no OpenStreetMap tag. PDOK's Locatieserver is the Dutch
 * government's own geocoder over the BAG address register — free, keyless,
 * statutory, no rate limit — and it is the one service that hands those codes
 * back for a coordinate. Nominatim does not, which is why a place geocoded
 * through the app's normal search cannot be joined to the figures at all.
 *
 * ⚠ THIS RETURNS AN AREA, NOT A PLACE. A neighbourhood is the finest grain the
 * crime figures have, and pretending otherwise anywhere downstream — a dot, a
 * radius, a "nearest incident" — is inventing evidence. `nl-crime.ts` carries
 * `basis: "area"` for the same reason.
 *
 * Everything above "Live fetching" is pure and pinned by `test/nl-areas.test.ts`.
 */

import type { BBox } from "./layers.ts";
import { endpoint, forwarderFailure, unreachableMessage } from "./endpoints.ts";
import type { LatLng } from "./osrm.ts";

export type AreaLevel = "buurt" | "wijk" | "gemeente";

export interface Area {
  level: AreaLevel;
  /** Normalised StatLine code — BU03630000 / WK036300 / GM0363. */
  code: string;
  name: string;
  /** Where to put the badge. The area's own centroid, from PDOK. */
  point: LatLng;
}

/**
 * StatLine writes region codes with a letter prefix and a fixed width; PDOK
 * sometimes hands back the bare number. `0363` is Amsterdam either way, but
 * only `GM0363` will ever match a row in the crime table — a bare code
 * compares unequal to every row and reads as a neighbourhood with no figures.
 */
export function normaliseAreaCode(level: AreaLevel, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "") return null;
  const prefix = level === "buurt" ? "BU" : level === "wijk" ? "WK" : "GM";
  const digits = trimmed.replace(/^(BU|WK|GM)/, "");
  if (!/^\d+$/.test(digits)) return null;
  const width = level === "buurt" ? 8 : level === "wijk" ? 6 : 4;
  return `${prefix}${digits.padStart(width, "0")}`;
}

/**
 * `POINT(4.893604 52.373055)` → a LatLng.
 *
 * TRAP: WKT is `POINT(lon lat)` — longitude FIRST, like GeoJSON and like OSRM,
 * and unlike Leaflet. Read the other way round every Dutch neighbourhood lands
 * in Somalia, which still draws a marker and still looks like a working map.
 */
export function parseWktPoint(raw: unknown): LatLng | null {
  if (typeof raw !== "string") return null;
  const match = /^\s*POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$/i.exec(raw);
  if (!match) return null;
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * One PDOK document → an area, or null.
 *
 * Most specific wins: a doc carrying a `buurtcode` is a neighbourhood even when
 * it is also inside a district and a municipality. Null rather than a default,
 * for the same reason `parseReports` drops an unparseable report: a defaulted
 * code would join to the wrong neighbourhood's figures and be indistinguishable
 * from a correct one.
 */
export function parseArea(raw: unknown): Area | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;

  const point = parseWktPoint(doc.centroide_ll);
  if (!point) return null;

  const levels: { level: AreaLevel; code: unknown; name: unknown }[] = [
    { level: "buurt", code: doc.buurtcode, name: doc.buurtnaam },
    { level: "wijk", code: doc.wijkcode, name: doc.wijknaam },
    { level: "gemeente", code: doc.gemeentecode, name: doc.gemeentenaam },
  ];

  for (const entry of levels) {
    const code = normaliseAreaCode(entry.level, entry.code);
    if (!code) continue;
    const named = typeof entry.name === "string" && entry.name.trim() !== ""
      ? entry.name.trim()
      : typeof doc.weergavenaam === "string" ? doc.weergavenaam.trim() : code;
    return { level: entry.level, code, name: named, point };
  }
  return null;
}

/** Every area a PDOK reply describes, deduplicated by code. */
export function parseAreas(reply: unknown): Area[] {
  const body = reply as { response?: { docs?: unknown } } | null;
  const docs = Array.isArray(body?.response?.docs) ? body.response.docs : [];
  const out: Area[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    const area = parseArea(doc);
    if (!area || seen.has(area.code)) continue;
    seen.add(area.code);
    out.push(area);
  }
  return out;
}

/**
 * Where to ask, inside the visible box.
 *
 * A grid rather than the centre alone, because the screen usually holds several
 * neighbourhoods and one probe would label the whole view with whichever one
 * the middle pixel happens to be in. Three by three is the compromise that has
 * to hold: nine probes covers a city view without turning a pan into a burst of
 * requests, and the results are deduplicated by code, so a view sitting inside
 * one neighbourhood costs nine cheap lookups and draws one badge.
 *
 * Inset by a sixth so the corners are not sampled on the boundary itself, where
 * a metre either way picks a different neighbourhood.
 */
export const PROBES_ACROSS = 3;

export function probePoints(bbox: BBox, across = PROBES_ACROSS): LatLng[] {
  const points: LatLng[] = [];
  const latSpan = bbox.north - bbox.south;
  const lngSpan = bbox.east - bbox.west;
  if (!(latSpan > 0) || !(lngSpan > 0)) return points;

  for (let row = 0; row < across; row += 1) {
    for (let column = 0; column < across; column += 1) {
      const fraction = (index: number) => (index + 0.5) / across;
      points.push({
        lat: Number((bbox.south + latSpan * fraction(row)).toFixed(6)),
        lng: Number((bbox.west + lngSpan * fraction(column)).toFixed(6)),
      });
    }
  }
  return points;
}

/* ─────────────────────────── neighbourhood shapes ─────────────────────────── */

/**
 * A neighbourhood's outline, as rings of points ready for Leaflet.
 *
 * Rings rather than one path, because a Dutch neighbourhood is routinely a
 * MultiPolygon — split by a canal, a railway or a motorway — and joining the
 * parts into one path draws a line across the water between them.
 */
export interface Boundary {
  code: string;
  name: string;
  rings: LatLng[][];
}

/**
 * The Netherlands, generously boxed.
 *
 * Used ONLY to settle the axis order of a reply, below. A region test is a
 * blunt instrument and it is justified here by the dataset: CBS wijkenbuurten
 * covers European Netherlands by construction, so a coordinate outside this
 * box is not a neighbourhood somewhere else — it is this one read backwards.
 */
const NL = { south: 50.6, west: 3.2, north: 53.7, east: 7.3 };

function insideNL(lat: number, lng: number): boolean {
  return lat >= NL.south && lat <= NL.north && lng >= NL.west && lng <= NL.east;
}

/**
 * Which way round a reply's coordinate pairs are.
 *
 * ⚠ THE TRAP THIS EXISTS FOR. GeoJSON is specified as `[lon, lat]`, and that
 * is what a GeoServer WFS emits — but `srsName=EPSG:4326` officially means
 * lat-first, servers disagree about which wins, and the two are
 * indistinguishable in the Netherlands because 4.9 and 52.3 are both valid
 * latitudes. Read backwards, every neighbourhood becomes a polygon off the
 * coast of Somalia: it parses, it draws, and the map looks empty rather than
 * wrong.
 *
 * So the order is MEASURED from the reply instead of assumed. The first pair
 * that is unambiguous — one way round lands in the Netherlands and the other
 * does not — decides it for the whole reply. When no pair is decisive the
 * answer is `null` and the caller drops the shapes rather than guessing, which
 * is the same rule `parseArea` applies to a missing code.
 */
export function detectAxisOrder(pairs: readonly (readonly number[])[]): "lon-lat" | "lat-lon" | null {
  for (const pair of pairs) {
    const first = pair[0];
    const second = pair[1];
    if (typeof first !== "number" || typeof second !== "number") continue;
    if (!Number.isFinite(first) || !Number.isFinite(second)) continue;

    const asLonLat = insideNL(second, first);
    const asLatLon = insideNL(first, second);
    if (asLonLat && !asLatLon) return "lon-lat";
    if (asLatLon && !asLonLat) return "lat-lon";
    // Both or neither: this pair cannot settle it. Try the next one.
  }
  return null;
}

/** Every coordinate pair in a GeoJSON geometry, at any nesting depth. */
function flattenPairs(node: unknown, out: number[][]): void {
  if (!Array.isArray(node)) return;
  if (typeof node[0] === "number" && typeof node[1] === "number") {
    out.push(node as number[]);
    return;
  }
  for (const child of node) flattenPairs(child, out);
}

/** One ring of coordinate pairs → points, in the order the reply uses. */
function ring(coords: unknown, order: "lon-lat" | "lat-lon"): LatLng[] {
  if (!Array.isArray(coords)) return [];
  const points: LatLng[] = [];
  for (const pair of coords) {
    if (!Array.isArray(pair)) continue;
    const first = pair[0];
    const second = pair[1];
    if (typeof first !== "number" || typeof second !== "number") continue;
    if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
    const lat = order === "lon-lat" ? second : first;
    const lng = order === "lon-lat" ? first : second;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    points.push({ lat, lng });
  }
  return points;
}

/**
 * A WFS GeoJSON reply → one boundary per neighbourhood.
 *
 * Polygon and MultiPolygon both handled, and the interior rings of a Polygon
 * are kept: a neighbourhood with a park or an industrial estate cut out of it
 * has a hole, and filling it in claims figures for ground the figures exclude.
 */
export function parseBoundaries(reply: unknown): Boundary[] {
  const body = reply as { features?: unknown } | null;
  const features = Array.isArray(body?.features) ? body.features : [];
  if (features.length === 0) return [];

  // Decide the axis order ONCE, from the whole reply, rather than per feature:
  // a server does not change its mind halfway down, and one decisive pair is
  // better evidence than a per-feature guess on an ambiguous one.
  const sample: number[][] = [];
  for (const feature of features) {
    const geometry = (feature as { geometry?: { coordinates?: unknown } })?.geometry;
    flattenPairs(geometry?.coordinates, sample);
    if (sample.length > 200) break;
  }
  const order = detectAxisOrder(sample);
  if (!order) return [];

  const out: Boundary[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const item = feature as {
      properties?: Record<string, unknown>;
      geometry?: { type?: unknown; coordinates?: unknown };
    };
    const code = normaliseAreaCode("buurt", item.properties?.buurtcode);
    if (!code || seen.has(code)) continue;

    const type = item.geometry?.type;
    const coords = item.geometry?.coordinates;
    const rings: LatLng[][] = [];
    if (type === "Polygon" && Array.isArray(coords)) {
      for (const one of coords) {
        const points = ring(one, order);
        if (points.length >= 3) rings.push(points);
      }
    } else if (type === "MultiPolygon" && Array.isArray(coords)) {
      for (const polygon of coords) {
        if (!Array.isArray(polygon)) continue;
        for (const one of polygon) {
          const points = ring(one, order);
          if (points.length >= 3) rings.push(points);
        }
      }
    }
    // A ring of two points is a line, not an area. Dropped rather than drawn.
    if (rings.length === 0) continue;

    seen.add(code);
    const name = typeof item.properties?.buurtnaam === "string"
      ? item.properties.buurtnaam.trim()
      : code;
    out.push({ code, name, rings });
  }
  return out;
}

/* ────────────────────────────── live fetching ─────────────────────────────── */

export const PDOK_BASE = endpoint("pdok");
export const PDOK_WFS_BASE = endpoint("pdokwfs");

/** A CQL string literal. Single quotes doubled, as CQL requires. */
function cqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The WFS query for a set of neighbourhood codes.
 *
 * Pure, so the awkward parts are testable: `typeNames` (WFS 2.0 spells it
 * plural — `typeName` is the 1.1 form and GeoServer answers an exception for
 * it), and a CQL `IN` filter rather than a bbox, which keeps the lat/lon axis
 * question out of the REQUEST entirely. See the note on `SERVICES.pdokwfs`.
 */
export function boundaryQuery(codes: readonly string[]): string | null {
  if (codes.length === 0) return null;
  const list = codes.map(cqlQuote).join(",");
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "wijkenbuurten:buurten",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: String(MAX_AREAS),
    cql_filter: `buurtcode IN (${list})`,
  });
  return `?${params.toString()}`;
}

/**
 * The outlines for the neighbourhoods we already hold figures for.
 *
 * Shapes are a nicety, not the layer: a failure here returns NO boundaries
 * rather than an error, and the caller falls back to the centroid badge on its
 * own. Losing the shading costs the reader some precision about where the
 * figure applies; failing the whole layer over it would cost them the figure.
 */
export async function fetchBoundaries(
  codes: readonly string[],
  options: { signal?: AbortSignal } = {},
): Promise<Boundary[]> {
  const search = boundaryQuery(codes);
  if (!search) return [];
  try {
    const response = await fetch(`${PDOK_WFS_BASE}${search}`, {
      headers: { Accept: "application/json" },
      signal: options.signal,
    });
    if (!response.ok) return [];
    return parseBoundaries(await response.json());
  } catch {
    return [];
  }
}

/**
 * How many neighbourhoods to carry at once.
 *
 * The badges stop being readable long before this, and every one of them is a
 * row in the CBS filter.
 */
export const MAX_AREAS = 12;

async function reverse(point: LatLng, signal?: AbortSignal): Promise<Area[]> {
  const search = `?lat=${point.lat}&lon=${point.lng}&type=buurt&rows=1`;
  const response = await fetch(`${PDOK_BASE}/reverse${search}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    const ours = forwarderFailure("pdok", response.status);
    throw new Error(ours ?? `PDOK answered ${response.status}.`);
  }
  return parseAreas(await response.json());
}

/**
 * The neighbourhoods under the visible map.
 *
 * The probes go out together — they are nine independent lookups against a
 * service with no rate limit, and doing them in turn would make the layer take
 * nine round trips to draw. A probe that fails is DROPPED rather than failing
 * the set: one lookup timing out should cost its own badge, not the layer.
 * Only when every one of them fails is that reported, because at that point
 * the thing that is wrong is not a lookup.
 */
export async function fetchAreas(
  bbox: BBox,
  options: { signal?: AbortSignal; across?: number } = {},
): Promise<{ ok: true; areas: Area[] } | { ok: false; error: string }> {
  const points = probePoints(bbox, options.across ?? PROBES_ACROSS);
  if (points.length === 0) return { ok: true, areas: [] };

  try {
    const results = await Promise.allSettled(
      points.map((point) => reverse(point, options.signal)),
    );

    const areas: Area[] = [];
    const seen = new Set<string>();
    let failures = 0;
    for (const result of results) {
      if (result.status === "rejected") {
        failures += 1;
        continue;
      }
      for (const area of result.value) {
        if (seen.has(area.code)) continue;
        seen.add(area.code);
        areas.push(area);
      }
    }

    if (failures === results.length) {
      return {
        ok: false,
        error: `${unreachableMessage("pdok", "PDOK")} The police figures are not loaded.`,
      };
    }
    return { ok: true, areas: areas.slice(0, MAX_AREAS) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "cancelled" };
    }
    return {
      ok: false,
      error: `${unreachableMessage("pdok", "PDOK")} The police figures are not loaded.`,
    };
  }
}
