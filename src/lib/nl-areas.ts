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

/* ────────────────────────────── live fetching ─────────────────────────────── */

export const PDOK_BASE = endpoint("pdok");

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
