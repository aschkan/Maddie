/**
 * What OpenStreetMap knows about the streets a route runs along.
 *
 * ONE data source, chosen deliberately. The alternative — recorded crime — is
 * published per neighbourhood per month, and a walking route usually sits
 * inside a single neighbourhood, so it gives every candidate route the same
 * number and cannot answer "which of these two streets". OSM changes metre by
 * metre, carries `lit=*` (the thing that most decides how a street feels after
 * dark, and the one you can act on by walking a different way), and is the same
 * data OSRM routed on — so the route and the read agree about the world.
 *
 * Queried from the BROWSER, like the tiles and the routing. The server is not
 * on the path for any of it.
 */

import { distanceM, distanceToPathM, pathLengthM, samplePath } from "./geo.ts";
import type { LatLng } from "./osrm.ts";

export const DEFAULT_OVERPASS =
  process.env.NEXT_PUBLIC_OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

/** How far off the line something still counts as being on it. */
const ON_ROUTE_M = 20;
const NEARBY_M = 35;
const SAMPLE_EVERY_M = 25;

export interface RouteFacts {
  lengthM: number;
  samples: number;
  /** Samples standing on a way tagged `lit=yes`. */
  litSamples: number;
  /** Samples on a way tagged `lit=no`. Not the same as untagged. */
  unlitSamples: number;
  /**
   * Samples whose street says nothing about lighting.
   *
   * Kept apart from `unlitSamples` on purpose: most streets in most of the
   * world are simply untagged, and reading that as "unlit" would report a gap
   * in the map as a dark street.
   */
  unknownLitSamples: number;
  /** Samples on a dedicated footway, path or pedestrian street. */
  footwaySamples: number;
  /** Samples inside a park, wood or scrub — pleasant by day, empty by night. */
  greenSamples: number;
  lamps: number;
  /** Shops, cafes, bars and the like near the line — frontage, and people. */
  venues: number;
  crossings: number;
  /** Tunnels and underpasses crossed. */
  tunnels: number;
}

/**
 * What the map says at ONE point along the route.
 *
 * The aggregate counts below are these, summed. They are kept rather than
 * folded away because a single number for a whole walk cannot say the useful
 * thing: not "61/100", but "the dark part is the 400 m through the park".
 * `segments.ts` re-sums them over sliding windows to get exactly that, and it
 * costs nothing extra — every one of these was already computed on the way to
 * the totals.
 */
export interface SampleRead {
  point: LatLng;
  /** Metres from the start of the route, so a window can be cut by distance. */
  alongM: number;
  /**
   * What the street underfoot says about lighting.
   *
   * Three states, never two: most streets in most of the world are simply
   * untagged, and reading "unknown" as "no" reports a gap in the map as a dark
   * street.
   */
  lit: "yes" | "no" | "unknown";
  footway: boolean;
  green: boolean;
  /**
   * A key identifying the tunnel this point is inside, when it is in one.
   *
   * A key rather than a flag because tunnels are counted, not measured: twenty
   * consecutive points under one underpass are one underpass, and the same
   * de-duplication has to work over a window as it does over a route.
   */
  tunnelId?: string;
  /** The street's name, where OSM has one. Used to name a bad stretch. */
  street?: string;
  /** Nodes nearest to this point, so a stretch can be counted on its own. */
  lamps: number;
  venues: number;
  crossings: number;
}

/** The counts, and the points they were summed from. */
export interface RouteRead {
  facts: RouteFacts;
  reads: SampleRead[];
}

interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: { lat?: number; lon?: number }[];
}

/** Points every this far along the route, used as the spine of the corridor. */
const SPINE_EVERY_M = 150;
/**
 * A ceiling on the spine.
 *
 * The coordinate list is repeated once per clause, so the query grows as
 * points × clauses — 250 points made a 34 KB query, which Overpass has to
 * parse before it can refuse it.
 */
const MAX_SPINE_POINTS = 120;

/**
 * One Overpass query for everything the read needs, along a CORRIDOR.
 *
 * Not a bounding box. A bbox around a 7.4 km route across Amsterdam covers
 * 7.5 km² — fifteen times the area the route occupies — and asking for every
 * `way["highway"]` and every shop inside that is an expensive enough query that
 * Overpass answers 504 whenever it is busy. That failure comes and goes, which
 * reads like a flaky connection and is actually a query that is too big.
 *
 * `around:` takes a polyline and matches anything within a radius of it, so the
 * query asks about the streets the route runs along rather than the rectangle
 * it happens to span.
 *
 * One query, not several: Overpass hands out a couple of slots per IP and
 * parallel queries are what earn a 429. `out tags geom` is needed because ways
 * have to be matched to the route by geometry — OSRM returns a line, not OSM
 * way ids.
 */
export function overpassQuery(path: LatLng[], timeoutS = 25): string | null {
  if (path.length < 2) return null;

  // The spine only bounds the search; more points than this lengthen the query
  // string without narrowing the corridor.
  let spine = samplePath(path, SPINE_EVERY_M);
  if (spine.length > MAX_SPINE_POINTS) {
    const stride = Math.ceil(spine.length / MAX_SPINE_POINTS);
    spine = spine.filter((_, index) => index % stride === 0 || index === spine.length - 1);
  }
  if (spine.length < 2) return null;

  // Five decimals is about a metre — more is noise in a 35 m corridor and only
  // makes the query longer.
  const line = spine.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(",");
  const near = `around:${NEARBY_M},${line}`;

  return `[out:json][timeout:${timeoutS}];
(
  way["highway"](${near});
  way["landuse"~"^(forest|grass|meadow|village_green)$"](${near});
  way["leisure"~"^(park|garden|nature_reserve)$"](${near});
  way["natural"~"^(wood|scrub)$"](${near});
  node["highway"~"^(street_lamp|crossing)$"](${near});
  node["amenity"~"^(cafe|bar|pub|restaurant|fast_food|pharmacy|fuel|police|hospital)$"](${near});
  node["shop"](${near});
);
out tags geom 2000;`;
}

function wayPath(element: OverpassElement): LatLng[] {
  const out: LatLng[] = [];
  for (const point of element.geometry ?? []) {
    if (typeof point?.lat === "number" && typeof point?.lon === "number") {
      out.push({ lat: point.lat, lng: point.lon });
    }
  }
  return out;
}

const GREEN = (tags: Record<string, string>): boolean =>
  /^(forest|grass|meadow|village_green)$/.test(tags.landuse ?? "") ||
  /^(park|garden|nature_reserve)$/.test(tags.leisure ?? "") ||
  /^(wood|scrub)$/.test(tags.natural ?? "");

const FOOTWAY = /^(footway|path|pedestrian|steps|living_street)$/;

/** Metres from the start of the route to each sample, in order. */
function alongMetres(samples: LatLng[]): number[] {
  const along: number[] = [];
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const here = samples[i];
    const previous = samples[i - 1];
    if (i > 0 && here && previous) total += distanceM(previous, here);
    along.push(total);
  }
  return along;
}

/**
 * The sample a node belongs to: the nearest one.
 *
 * Nodes are counted against a POINT on the route rather than the route as a
 * whole so that a stretch can be counted on its own — twelve cafes clustered at
 * the far end are not frontage along the dark middle, and the aggregate could
 * never tell the two apart.
 */
function nearestSample(point: LatLng, samples: LatLng[]): number {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (!sample) continue;
    const d = distanceM(point, sample);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Turn Overpass elements into the numbers the score is built from.
 *
 * Deliberately deterministic and separate from any model: these are counts of
 * what the map says, and nothing here is a judgement. The judgement is applied
 * afterwards, to numbers that can be checked.
 *
 * Both resolutions come out of the one pass. The totals are what the score and
 * the model are given; the per-point reads are what `segments.ts` re-sums to
 * find the worst stretch. Computing them twice would mean two answers that can
 * drift apart, and the second pass is not free — matching a point to the street
 * underfoot is the expensive part of this whole app.
 */
export function readRoute(path: LatLng[], elements: OverpassElement[]): RouteRead {
  const samples = samplePath(path, SAMPLE_EVERY_M);
  const along = alongMetres(samples);

  const highways: { tags: Record<string, string>; line: LatLng[] }[] = [];
  const greens: LatLng[][] = [];

  const reads: SampleRead[] = samples.map((point, index) => ({
    point,
    alongM: along[index] ?? 0,
    lit: "unknown",
    footway: false,
    green: false,
    lamps: 0,
    venues: 0,
    crossings: 0,
  }));

  let lamps = 0;
  let venues = 0;
  let crossings = 0;

  for (const element of elements) {
    const tags = element.tags ?? {};

    if (element.type === "node") {
      if (typeof element.lat !== "number" || typeof element.lon !== "number") continue;
      const point = { lat: element.lat, lng: element.lon };
      const away = distanceToPathM(point, path);

      let counted: "lamps" | "venues" | "crossings" | null = null;
      if (tags.highway === "street_lamp") {
        if (away <= NEARBY_M) { lamps++; counted = "lamps"; }
      } else if (tags.highway === "crossing") {
        if (away <= ON_ROUTE_M) { crossings++; counted = "crossings"; }
      } else if (tags.amenity || tags.shop) {
        if (away <= NEARBY_M) { venues++; counted = "venues"; }
      }

      if (counted) {
        const index = nearestSample(point, samples);
        const read = reads[index];
        if (read) read[counted]++;
      }
      continue;
    }

    if (element.type !== "way") continue;
    const line = wayPath(element);
    if (line.length < 2) continue;

    if (tags.highway) highways.push({ tags, line });
    else if (GREEN(tags)) greens.push(line);
  }

  let litSamples = 0;
  let unlitSamples = 0;
  let unknownLitSamples = 0;
  let footwaySamples = 0;
  let greenSamples = 0;
  const tunnelIds = new Set<string>();

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const read = reads[index];
    if (!sample || !read) continue;

    // The street this sample is standing on: the nearest highway within
    // ON_ROUTE_M. Anything further away is a different street.
    let nearest: { tags: Record<string, string>; d: number } | null = null;
    for (const way of highways) {
      const d = distanceToPathM(sample, way.line);
      if (d <= ON_ROUTE_M && (nearest === null || d < nearest.d)) nearest = { tags: way.tags, d };
    }

    if (nearest) {
      const lit = nearest.tags.lit;
      if (lit === "yes" || lit === "24/7" || lit === "sunset-sunrise") { litSamples++; read.lit = "yes"; }
      else if (lit === "no") { unlitSamples++; read.lit = "no"; }
      else unknownLitSamples++;

      if (FOOTWAY.test(nearest.tags.highway ?? "")) { footwaySamples++; read.footway = true; }
      if (nearest.tags.tunnel && nearest.tags.tunnel !== "no") {
        const id = `${nearest.tags.name ?? ""}:${nearest.tags.tunnel}`;
        tunnelIds.add(id);
        read.tunnelId = id;
      }
      // The name is for saying WHICH stretch is the bad one. An unnamed way
      // stays unnamed rather than being given a made-up label.
      if (nearest.tags.name) read.street = nearest.tags.name;
    } else {
      unknownLitSamples++;
    }

    for (const green of greens) {
      if (distanceToPathM(sample, green) <= ON_ROUTE_M) {
        greenSamples++;
        read.green = true;
        break;
      }
    }
  }

  return {
    reads,
    facts: {
      lengthM: Math.round(pathLengthM(path)),
      samples: samples.length,
      litSamples,
      unlitSamples,
      unknownLitSamples,
      footwaySamples,
      greenSamples,
      lamps,
      venues,
      crossings,
      tunnels: tunnelIds.size,
    },
  };
}

/** Just the totals, for callers that have no use for the individual points. */
export function computeFacts(path: LatLng[], elements: OverpassElement[]): RouteFacts {
  return readRoute(path, elements).facts;
}

/** Ask Overpass. Never throws; the caller gets a reason instead. */
export async function fetchFacts(
  path: LatLng[],
  options: { base?: string; signal?: AbortSignal } = {},
): Promise<{ ok: true; facts: RouteFacts; reads: SampleRead[] } | { ok: false; error: string }> {
  const query = overpassQuery(path);
  if (!query) return { ok: false, error: "No route to look at." };

  try {
    const response = await fetch(options.base ?? DEFAULT_OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: options.signal,
    });
    if (response.status === 429) {
      return { ok: false, error: "OpenStreetMap's query service is rate limiting us. Try again in a minute." };
    }
    if (response.status === 504) {
      // Overpass timed out running the query. It reached them — this is not a
      // connection problem, and saying so stops the next hour being spent on
      // the network instead of on the query.
      return {
        ok: false,
        error: "OpenStreetMap's query service timed out on this route. It is busy — try again, or try a shorter route.",
      };
    }
    if (!response.ok) {
      return { ok: false, error: `OpenStreetMap's query service answered ${response.status}.` };
    }
    const body = (await response.json()) as { elements?: OverpassElement[] };
    if (!Array.isArray(body?.elements)) {
      return { ok: false, error: "OpenStreetMap sent something unreadable." };
    }
    const read = readRoute(path, body.elements);
    return { ok: true, facts: read.facts, reads: read.reads };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "cancelled" };
    }
    return { ok: false, error: "Could not reach OpenStreetMap's query service from this browser." };
  }
}
