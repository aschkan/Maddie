/**
 * Putting a place together: gather every signal, score the eleven dimensions,
 * and report the gaps as loudly as the findings.
 *
 * Scores are time-dependent BY DESIGN. The same street scores 78 at 3pm and 34
 * at 1am, and that difference is the whole product — so every result is
 * computed for an explicit timestamp the caller can change.
 */
import { getConfig } from "../config.ts";
import { bboxAround } from "../geo/distance.ts";
import type { LatLng } from "../geo/wkt.ts";
import { absent, clamp01, type Signal } from "../signal.ts";
import { areaForPoint } from "../sources/geocode.ts";
import type { AreaCode, GeoPlace } from "../sources/pdok.ts";
import { fetchAreaCrime, fetchAreaNuisance, type CrimeSummary } from "../sources/nl-crime.ts";
import { areaQuery, overpassBatch } from "../sources/overpass.ts";
import { fetchWeather, timezoneFor, type WeatherNow } from "../sources/weather.ts";
import { fetchStreetImages } from "../sources/mapillary.ts";
import { readStreetImagery } from "../ai/tasks.ts";
import { reportsNear } from "../store/repositories.ts";
import { darkness as darknessAt, localHour as localHourAt } from "./sun.ts";
import { summariseOsm, type OsmSignals } from "./osm.ts";
import {
  DIMENSION_ORDER,
  DIMENSION_WEIGHTS,
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
  type DimensionKey,
  type DimensionScore,
  type ReportsSummary,
  type ReviewReading,
  type VisionReading,
} from "./dimensions.ts";

export type SafetyBand = "unknown" | "poor" | "caution" | "fair" | "good";

export interface SafetyAssessment {
  point: LatLng;
  at: string;
  timezone: string;
  localHour: number;
  darkness: number;
  place: GeoPlace | null;
  area: AreaCode | null;
  overall: {
    score: number | null;
    confidence: number;
    band: SafetyBand;
    /** Share of the weighting that rested on something actually measured. */
    coverage: number;
  };
  dimensions: DimensionScore[];
  /** Everything we could not see, in the reader's words. */
  gaps: string[];
  crime: Signal<CrimeSummary>;
  nuisance: Signal<CrimeSummary>;
  weather: Signal<WeatherNow>;
  vision: Signal<VisionReading> | null;
  osm: OsmSignals;
  reports: ReportsSummary;
}

/** Rough Netherlands envelope, for telling "outside our data" from "nothing here". */
export function withinRegion(point: LatLng, region: string): boolean {
  if (region !== "NL") return true;
  return point.lat >= 50.6 && point.lat <= 53.8 && point.lng >= 3.1 && point.lng <= 7.4;
}

export function band(score: number | null, confidence: number): SafetyBand {
  if (score === null || confidence < 0.12) return "unknown";
  if (score < 35) return "poor";
  if (score < 55) return "caution";
  if (score < 75) return "fair";
  return "good";
}

export interface Combined {
  score: number | null;
  confidence: number;
  coverage: number;
}

/**
 * Below this share of the total weighting, there is no score at all.
 *
 * Without it, a place where only `environment` could be measured — a dimension
 * computed offline that cannot fail — comes back as 100. A grey badge does not
 * undo the number: 100 on a screen reads as "perfectly safe", which is exactly
 * the reassurance a gap must never produce.
 */
export const MINIMUM_COVERAGE = 0.15;

/**
 * A missing dimension is dropped from the average and its weight is charged
 * against confidence. It never scores a neutral 50, because 50 is a claim.
 */
export function combine(dimensions: readonly DimensionScore[]): Combined {
  let weighted = 0;
  let weightUsed = 0;
  let confidenceWeight = 0;
  const totalWeight = DIMENSION_ORDER.reduce((sum, key) => sum + DIMENSION_WEIGHTS[key], 0);

  for (const dimension of dimensions) {
    const weight = DIMENSION_WEIGHTS[dimension.key];
    if (dimension.score === null || dimension.confidence <= 0) continue;
    const effective = weight * dimension.confidence;
    weighted += dimension.score * effective;
    weightUsed += effective;
    confidenceWeight += weight;
  }

  if (weightUsed <= 0) return { score: null, confidence: 0, coverage: 0 };
  const coverage = confidenceWeight / totalWeight;
  if (coverage < MINIMUM_COVERAGE) {
    // Too little of the picture to put a number on it. The coverage is still
    // reported, so the surface can say what was and was not looked at.
    return { score: null, confidence: 0, coverage };
  }
  return {
    score: Math.round(weighted / weightUsed),
    // Confidence is the average confidence of what we measured, discounted by
    // how much of the picture we measured at all.
    confidence: clamp01((weightUsed / Math.max(1e-6, confidenceWeight)) * coverage),
    coverage,
  };
}

export interface AssessOptions {
  point: LatLng;
  at?: Date;
  radiusMetres?: number;
  /** Off for route segments: forty imagery passes is not a page load. */
  withImagery?: boolean;
  reviews?: Signal<ReviewReading> | null;
}

export async function assessPoint(options: AssessOptions): Promise<SafetyAssessment> {
  const config = getConfig();
  const point = options.point;
  const at = options.at ?? new Date();
  const radiusMetres = options.radiusMetres ?? 350;
  const timezone = timezoneFor(point);
  const dark = darknessAt(at, point);
  const hour = localHourAt(at, timezone);
  const inRegion = withinRegion(point, config.region);

  const [located, osmBatch, weather, reports] = await Promise.all([
    areaForPoint(point),
    overpassBatch([areaQuery(bboxAround(point, radiusMetres))]),
    fetchWeather(point),
    reportsNear(point, radiusMetres),
  ]);

  const coverage = osmBatch.succeeded === 0 ? "none" : osmBatch.failed > 0 ? "partial" : "measured";
  const osm = summariseOsm(osmBatch.features, point, radiusMetres, coverage);

  const outOfRegionNote = `This deployment carries Dutch police figures only, and this point is outside the Netherlands. No recorded-crime data was consulted. That is a gap in the data, not a statement about the place.`;

  let crime: Signal<CrimeSummary>;
  let nuisance: Signal<CrimeSummary>;
  if (!inRegion) {
    crime = absent("out-of-region", `CBS StatLine ${config.crimeTable}`, outOfRegionNote);
    nuisance = absent("out-of-region", "CBS StatLine 47024NED", outOfRegionNote);
  } else if (located.area === null) {
    const note =
      located.note ??
      "No CBS neighbourhood could be resolved for this point, so the police figures were not looked up. That is a gap in the data, not a statement about the place.";
    crime = absent("no-coverage", `CBS StatLine ${config.crimeTable}`, note);
    nuisance = absent("no-coverage", "CBS StatLine 47024NED", note);
  } else {
    [crime, nuisance] = await Promise.all([
      fetchAreaCrime({ area: located.area, now: at }),
      fetchAreaNuisance({ area: located.area, now: at }),
    ]);
  }

  let vision: Signal<VisionReading> | null = null;
  if (options.withImagery === true && config.streetViewEnabled && config.streetViewMaxImages > 0) {
    const images = await fetchStreetImages(point, config.streetViewMaxImages);
    vision = images.available
      ? await readStreetImagery(images.value, point)
      : absent(images.reason, images.source, images.note);
  }

  const dimensions: DimensionScore[] = [
    lighting(osm, dark, vision),
    footTraffic(osm, hour, dark),
    openVenues(osm, hour, null),
    visibility(osm, dark),
    refuge(osm, hour),
    transitAccess(osm),
    guardianship(osm, hour),
    walkability(osm),
    incidentHistory(crime),
    harassmentSignals(nuisance, crime, reports, options.reviews ?? null),
    environment(weather, dark),
  ];
  const ordered = DIMENSION_ORDER.map(
    (key) => dimensions.find((dimension) => dimension.key === key) ?? unmeasuredFallback(key),
  );

  const combined = combine(ordered);

  const gaps: string[] = [];
  if (!crime.available) gaps.push(crime.note);
  if (!nuisance.available && nuisance.note !== crime.note) gaps.push(nuisance.note);
  if (!weather.available) gaps.push(weather.note);
  if (vision !== null && !vision.available) gaps.push(vision.note);
  if (osm.coverage === "none") {
    gaps.push(
      "No OpenStreetMap data was returned for this area, so lighting, venues and transit were not measured. That is a gap in the data, not a statement about the place.",
    );
  } else if (osm.coverage === "partial") {
    gaps.push("Part of the map data for this area did not arrive before the deadline, so these figures are incomplete.");
  }
  for (const note of osmBatch.notes) if (!gaps.includes(note)) gaps.push(note);
  if (!reports.measured) {
    gaps.push("Community reports could not be read, so none were counted. That is a gap in the data, not a statement about the place.");
  }

  return {
    point,
    at: at.toISOString(),
    timezone,
    localHour: hour,
    darkness: dark,
    place: located.place,
    area: located.area,
    overall: {
      score: combined.score,
      confidence: combined.confidence,
      band: band(combined.score, combined.confidence),
      coverage: combined.coverage,
    },
    dimensions: ordered,
    gaps: [...new Set(gaps)],
    crime,
    nuisance,
    weather,
    vision,
    osm,
    reports: { measured: reports.measured, total: reports.total, last90Days: reports.last90Days, byCategory: reports.byCategory },
  };
}

function unmeasuredFallback(key: DimensionKey): DimensionScore {
  return {
    key,
    label: key,
    score: null,
    confidence: 0,
    basis: null,
    why: "This signal was not measured. That is a gap in the data, not a statement about the place.",
  };
}
