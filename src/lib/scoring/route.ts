/**
 * Routes are scored per SEGMENT, not as one number.
 *
 * A walk that is fine for 900 metres and frightening for the last 200 is not a
 * "72". The last 200 metres are the whole answer, and they are what this
 * surfaces.
 */
import { getConfig } from "../config.ts";
import { haversineMetres, midpoint, pathLengthMetres, segmentPath, type BBox } from "../geo/distance.ts";
import { encodePolyline } from "../geo/polyline.ts";
import type { LatLng } from "../geo/wkt.ts";
import { absent, type Signal } from "../signal.ts";
import { areaForPoint } from "../sources/geocode.ts";
import { fetchAreaCrime, fetchAreaNuisance, type CrimeSummary } from "../sources/nl-crime.ts";
import { areaQuery, overpassBatch, type OsmFeature } from "../sources/overpass.ts";
import { walkingRoutes, type WalkingRoute } from "../sources/valhalla.ts";
import { fetchWeather, timezoneFor, type WeatherNow } from "../sources/weather.ts";
import { reportsNear } from "../store/repositories.ts";
import { summariseOsm } from "./osm.ts";
import { darkness as darknessAt, localHour as localHourAt } from "./sun.ts";
import { band, combine, withinRegion, type SafetyBand } from "./assess.ts";
import {
  DIMENSION_ORDER,
  environment,
  footTraffic,
  guardianship,
  harassmentSignals,
  incidentHistory,
  lighting,
  openVenues,
  refuge,
  transitAccess,
  visibility,
  walkability,
  type DimensionScore,
} from "./dimensions.ts";

export interface SegmentScore {
  index: number;
  start: LatLng;
  end: LatLng;
  midpoint: LatLng;
  lengthMetres: number;
  score: number | null;
  confidence: number;
  band: SafetyBand;
  areaName: string | null;
  dimensions: DimensionScore[];
  gaps: string[];
}

export interface RouteAssessment {
  /** Re-encoded at precision 5 for consumers; Valhalla hands out 6. */
  polyline: string;
  points: LatLng[];
  distanceMetres: number;
  durationSeconds: number;
  score: number | null;
  confidence: number;
  band: SafetyBand;
  segments: SegmentScore[];
  worstSegmentIndex: number | null;
  gaps: string[];
}

export interface RouteOutcome {
  routes: RouteAssessment[];
  at: string;
  timezone: string;
  localHour: number;
  darkness: number;
  note: string | null;
}

function routeBBox(points: readonly LatLng[], padMetres = 200): BBox {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  for (const point of points) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
  }
  const latPad = (padMetres / 111_320) * 1;
  const lngPad = latPad / Math.max(0.01, Math.cos((((south + north) / 2) * Math.PI) / 180));
  return { south: south - latPad, north: north + latPad, west: west - lngPad, east: east + lngPad };
}

/**
 * One query per ~1.5 km tile rather than one per segment. Forty segments would
 * be forty Overpass queries at concurrency 1 — the deadline would eat the
 * route before the page ever saw it.
 */
export function tileBBoxes(box: BBox, maxSpanMetres = 1_500): BBox[] {
  const latSpan = (box.north - box.south) * 111_320;
  const midLat = (box.north + box.south) / 2;
  const lngSpan = (box.east - box.west) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const rows = Math.max(1, Math.ceil(latSpan / maxSpanMetres));
  const cols = Math.max(1, Math.ceil(lngSpan / maxSpanMetres));
  const tiles: BBox[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      tiles.push({
        south: box.south + ((box.north - box.south) * row) / rows,
        north: box.south + ((box.north - box.south) * (row + 1)) / rows,
        west: box.west + ((box.east - box.west) * col) / cols,
        east: box.west + ((box.east - box.west) * (col + 1)) / cols,
      });
    }
  }
  return tiles;
}

interface AreaSignals {
  name: string | null;
  crime: Signal<CrimeSummary>;
  nuisance: Signal<CrimeSummary>;
}

async function areaSignalsFor(point: LatLng, at: Date, cache: Map<string, AreaSignals>): Promise<AreaSignals> {
  const config = getConfig();
  if (!withinRegion(point, config.region)) {
    const note =
      "This deployment carries Dutch police figures only, and this segment is outside the Netherlands. That is a gap in the data, not a statement about the place.";
    return {
      name: null,
      crime: absent("out-of-region", `CBS StatLine ${config.crimeTable}`, note),
      nuisance: absent("out-of-region", "CBS StatLine 47024NED", note),
    };
  }

  const located = await areaForPoint(point);
  if (located.area === null) {
    const note =
      located.note ??
      "No CBS neighbourhood could be resolved for this segment, so the police figures were not looked up. That is a gap in the data, not a statement about the place.";
    return {
      name: null,
      crime: absent("no-coverage", `CBS StatLine ${config.crimeTable}`, note),
      nuisance: absent("no-coverage", "CBS StatLine 47024NED", note),
    };
  }

  const cacheKey = located.area.code;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  const [crime, nuisance] = await Promise.all([
    fetchAreaCrime({ area: located.area, now: at }),
    fetchAreaNuisance({ area: located.area, now: at }),
  ]);
  const signals: AreaSignals = { name: located.area.name, crime, nuisance };
  cache.set(cacheKey, signals);
  return signals;
}

async function scoreSegment(
  index: number,
  points: readonly LatLng[],
  features: readonly OsmFeature[],
  coverage: "measured" | "partial" | "none",
  at: Date,
  timezone: string,
  weather: Signal<WeatherNow>,
  areaCache: Map<string, AreaSignals>,
): Promise<SegmentScore> {
  const centre = midpoint(points);
  const lengthMetres = pathLengthMetres(points);
  const radius = Math.max(120, Math.min(300, lengthMetres));
  const hour = localHourAt(at, timezone);
  const dark = darknessAt(at, centre);

  const nearby = features.filter(
    (feature) => feature.point !== null && haversineMetres(centre, feature.point) <= radius * 1.5,
  );
  const osm = summariseOsm(nearby, centre, radius, coverage);

  const [areaSignals, reports] = await Promise.all([
    areaSignalsFor(centre, at, areaCache),
    reportsNear(centre, radius),
  ]);

  const dimensions: DimensionScore[] = [
    lighting(osm, dark, null),
    footTraffic(osm, hour, dark),
    openVenues(osm, hour, null),
    visibility(osm, dark),
    refuge(osm, hour),
    transitAccess(osm),
    guardianship(osm, hour),
    walkability(osm),
    incidentHistory(areaSignals.crime),
    harassmentSignals(areaSignals.nuisance, areaSignals.crime, reports, null),
    environment(weather, dark),
  ];
  const ordered = DIMENSION_ORDER.map((key) => dimensions.find((dimension) => dimension.key === key)!);
  const combined = combine(ordered);

  const gaps: string[] = [];
  if (!areaSignals.crime.available) gaps.push(areaSignals.crime.note);
  if (osm.coverage === "none") {
    gaps.push("No map data arrived for this stretch, so it was not measured. That is a gap in the data, not a statement about the place.");
  }

  return {
    index,
    start: points[0]!,
    end: points[points.length - 1]!,
    midpoint: centre,
    lengthMetres,
    score: combined.score,
    confidence: combined.confidence,
    band: band(combined.score, combined.confidence),
    areaName: areaSignals.name,
    dimensions: ordered,
    gaps: [...new Set(gaps)],
  };
}

async function assessOne(
  route: WalkingRoute,
  at: Date,
  timezone: string,
  weather: Signal<WeatherNow>,
  areaCache: Map<string, AreaSignals>,
): Promise<RouteAssessment> {
  const segments = segmentPath(route.points, 250);
  const tiles = tileBBoxes(routeBBox(route.points));
  const batch = await overpassBatch(tiles.map((tile) => areaQuery(tile)));
  const coverage = batch.succeeded === 0 ? "none" : batch.failed > 0 ? "partial" : "measured";

  const scored: SegmentScore[] = [];
  for (const [index, points] of segments.entries()) {
    scored.push(await scoreSegment(index, points, batch.features, coverage, at, timezone, weather, areaCache));
  }

  // The route's score is the WORST stretch pulled towards the average — a walk
  // is only as safe as the part of it you would not want to do.
  const measuredSegments = scored.filter((segment) => segment.score !== null);
  let score: number | null = null;
  let confidence = 0;
  if (measuredSegments.length > 0) {
    const worst = Math.min(...measuredSegments.map((segment) => segment.score!));
    const totalLength = measuredSegments.reduce((sum, segment) => sum + segment.lengthMetres, 0);
    const mean =
      measuredSegments.reduce((sum, segment) => sum + segment.score! * segment.lengthMetres, 0) /
      Math.max(1, totalLength);
    score = Math.round(0.45 * worst + 0.55 * mean);
    confidence =
      measuredSegments.reduce((sum, segment) => sum + segment.confidence, 0) / measuredSegments.length;
  }

  const worstIndex =
    measuredSegments.length === 0
      ? null
      : measuredSegments.reduce((worst, segment) => (segment.score! < worst.score! ? segment : worst)).index;

  const gaps = [...new Set([...batch.notes, ...scored.flatMap((segment) => segment.gaps)])];

  return {
    // Decoded at 1e6 from Valhalla, handed on at 1e5 — the precision every
    // consumer expects.
    polyline: encodePolyline(route.points, 5),
    points: route.points,
    distanceMetres: route.distanceMetres,
    durationSeconds: route.durationSeconds,
    score,
    confidence,
    band: band(score, confidence),
    segments: scored,
    worstSegmentIndex: worstIndex,
    gaps,
  };
}

export async function assessRoutes(from: LatLng, to: LatLng, at: Date = new Date()): Promise<RouteOutcome> {
  const timezone = timezoneFor(from);
  const base = {
    at: at.toISOString(),
    timezone,
    localHour: localHourAt(at, timezone),
    darkness: darknessAt(at, from),
  };

  const routing = await walkingRoutes(from, to, 2);
  if (!routing.ok) return { ...base, routes: [], note: routing.note };

  const weather = await fetchWeather(from);
  const areaCache = new Map<string, AreaSignals>();
  const assessed: RouteAssessment[] = [];
  for (const route of routing.routes.slice(0, 3)) {
    assessed.push(await assessOne(route, at, timezone, weather, areaCache));
  }

  // Safest first — not fastest. That is the point of the surface.
  assessed.sort((left, right) => (right.score ?? -1) - (left.score ?? -1));
  return { ...base, routes: assessed, note: null };
}
