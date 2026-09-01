/**
 * The eleven dimensions.
 *
 * Every one of them returns a score AND a confidence, and any of them may
 * return "not measured" — which is not a score of 50. A missing signal lowers
 * confidence; it never quietly scores neutral, because a neutral score is a
 * claim and a gap is not.
 */
import { clamp01, type Signal } from "../signal.ts";
import type { CrimeSummary } from "../sources/nl-crime.ts";
import { CRIME_SEVERITY } from "../sources/nl-crime.ts";
import type { WeatherNow } from "../sources/weather.ts";
import { perSquareKm, type OsmSignals } from "./osm.ts";

export type DimensionKey =
  | "lighting"
  | "footTraffic"
  | "openVenues"
  | "visibility"
  | "refuge"
  | "transitAccess"
  | "guardianship"
  | "walkability"
  | "incidentHistory"
  | "harassmentSignals"
  | "environment";

export const DIMENSION_ORDER: DimensionKey[] = [
  "lighting",
  "footTraffic",
  "openVenues",
  "visibility",
  "refuge",
  "transitAccess",
  "guardianship",
  "walkability",
  "incidentHistory",
  "harassmentSignals",
  "environment",
];

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  lighting: "Street lighting",
  footTraffic: "People about",
  openVenues: "Open at this hour",
  visibility: "Sightlines",
  refuge: "Somewhere to go in",
  transitAccess: "Getting away",
  guardianship: "Overlooked by others",
  walkability: "Walkable on foot",
  incidentHistory: "Recorded crime",
  harassmentSignals: "Harassment signals",
  environment: "Conditions right now",
};

/** What the overall score is made of. Sums to 1. */
export const DIMENSION_WEIGHTS: Record<DimensionKey, number> = {
  lighting: 0.14,
  incidentHistory: 0.14,
  harassmentSignals: 0.12,
  guardianship: 0.11,
  footTraffic: 0.1,
  openVenues: 0.09,
  visibility: 0.08,
  refuge: 0.08,
  transitAccess: 0.06,
  walkability: 0.05,
  environment: 0.03,
};

export interface DimensionScore {
  key: DimensionKey;
  label: string;
  /** null means NOT MEASURED. It is never a polite 50. */
  score: number | null;
  confidence: number;
  /** What kind of evidence this rests on, so the reader can weigh it. */
  basis: "osm" | "area" | "point" | "community" | "model" | "computed" | null;
  why: string;
}

function measured(
  key: DimensionKey,
  score: number,
  confidence: number,
  basis: DimensionScore["basis"],
  why: string,
): DimensionScore {
  return {
    key,
    label: DIMENSION_LABELS[key],
    score: Math.round(Math.min(100, Math.max(0, score))),
    confidence: clamp01(confidence),
    basis,
    why,
  };
}

function unmeasured(key: DimensionKey, why: string): DimensionScore {
  return { key, label: DIMENSION_LABELS[key], score: null, confidence: 0, basis: null, why };
}

/** 0..100, rising with `value`, half-way at `midpoint`. */
export function logistic(value: number, midpoint: number, steepness: number): number {
  return 100 / (1 + Math.exp(-(value - midpoint) / steepness));
}

// ── Crime, on two structurally different bases ──────────────────────────────

/**
 * Point data and area data are NOT the same measurement.
 *
 * A UK/US feed gives one row per offence with a fuzzed point, so the natural
 * unit is severity-weighted offences per square kilometre per month, and the
 * distance to each one means something. The Dutch figures are counts per
 * NEIGHBOURHOOD per month: there is nothing to plot and nothing to measure a
 * distance to. Inventing points inside a neighbourhood so the two shapes match
 * is fabricating evidence, so instead each basis gets its own curve, in its own
 * units, and area data carries lower confidence.
 */
export function areaCrimeScore(severityPerMonth: number): number {
  const ceiling = Math.log10(1 + 100);
  const ratio = Math.log10(1 + Math.max(0, severityPerMonth)) / ceiling;
  return 100 * (1 - Math.min(1, ratio));
}

export function pointCrimeScore(severityPerKm2PerMonth: number): number {
  const ceiling = Math.log10(1 + 40);
  const ratio = Math.log10(1 + Math.max(0, severityPerKm2PerMonth)) / ceiling;
  return 100 * (1 - Math.min(1, ratio));
}

/** Confidence floors from §8: area data is worth less than located data. */
export const BASIS_CONFIDENCE = { area: 0.4, point: 0.55 } as const;

export function incidentHistory(crime: Signal<CrimeSummary>): DimensionScore {
  if (!crime.available) return unmeasured("incidentHistory", crime.note);
  const summary = crime.value;
  // TRAP: `incidents.length` is not the quantity on the area basis — the
  // incidents array is empty by construction. `totalCount` is the quantity.
  const score = areaCrimeScore(summary.severityPerMonth);
  const violent =
    summary.byCategory["sexual-offence"] + summary.byCategory["violence-against-person"] + summary.byCategory.robbery;
  const why =
    summary.totalCount === 0
      ? `No offences were recorded in ${summary.areaName} across ${summary.monthsObserved} months of published figures.`
      : `${summary.totalCount} offences recorded in ${summary.areaName} across ${summary.monthsObserved} months, ${violent} of them violent or sexual.`;
  return measured("incidentHistory", score, crime.confidence, "area", why);
}

export function harassmentSignals(
  nuisance: Signal<CrimeSummary>,
  crime: Signal<CrimeSummary>,
  reports: ReportsSummary,
  reviews: Signal<ReviewReading> | null,
): DimensionScore {
  const parts: Array<{ score: number; weight: number; why: string }> = [];

  if (nuisance.available) {
    const summary = nuisance.value;
    parts.push({
      score: areaCrimeScore(summary.offencesPerMonth * 0.45),
      weight: nuisance.confidence,
      why: `${summary.totalCount} nuisance reports (street drinking, loitering, harassment) recorded here over ${summary.monthsObserved} months.`,
    });
  }

  if (crime.available) {
    const sexual = crime.value.byCategory["sexual-offence"];
    const perMonth = sexual / Math.max(1, crime.value.monthsObserved);
    parts.push({
      score: 100 * (1 - Math.min(1, Math.log10(1 + perMonth * CRIME_SEVERITY["sexual-offence"]) / Math.log10(6))),
      weight: crime.confidence,
      why:
        sexual === 0
          ? "No sexual offences appear in the published figures for this neighbourhood."
          : `${sexual} sexual offences recorded in this neighbourhood over ${crime.value.monthsObserved} months.`,
    });
  }

  if (reports.measured && reports.total > 0) {
    const harassment = reports.byCategory.harassment + reports.byCategory.following + reports.byCategory.assault;
    parts.push({
      score: 100 * (1 - Math.min(1, harassment / 6)),
      // Community reports are few and self-selected, so they are never allowed
      // to dominate — but a woman saying she was followed here is evidence.
      weight: 0.45,
      why: `${reports.total} community reports about this area, ${harassment} of them about harassment, being followed, or assault.`,
    });
  }

  if (reviews?.available === true && reviews.value.harassmentMentions !== null) {
    parts.push({
      score: 100 * (1 - Math.min(1, reviews.value.harassmentMentions / 4)),
      weight: reviews.confidence,
      why: reviews.value.summary,
    });
  }

  if (parts.length === 0) {
    return unmeasured(
      "harassmentSignals",
      "Nothing was available about harassment here — no nuisance figures, no community reports, no reviews. That is a gap in the data, not a statement about the place.",
    );
  }

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = parts.reduce((sum, part) => sum + part.score * part.weight, 0) / Math.max(1e-6, totalWeight);
  return measured(
    "harassmentSignals",
    score,
    Math.min(0.65, totalWeight / parts.length + 0.1 * (parts.length - 1)),
    parts.length === 1 && nuisance.available ? "area" : "community",
    parts.map((part) => part.why).join(" "),
  );
}

// ── OSM-derived dimensions ──────────────────────────────────────────────────

export interface VisionReading {
  lighting: number | null;
  sightlines: number | null;
  summary: string;
}

export interface ReviewReading {
  staffProtective: number | null;
  harassmentMentions: number | null;
  summary: string;
}

export type ReportCategory =
  | "harassment"
  | "following"
  | "assault"
  | "lighting"
  | "feltUnsafe"
  | "feltSafe"
  | "other";

export interface ReportsSummary {
  measured: boolean;
  total: number;
  last90Days: number;
  byCategory: Record<ReportCategory, number>;
}

const OSM_GAP =
  "OpenStreetMap data could not be fetched for this area, so this signal was not measured. That is a gap in the data, not a statement about the place.";

export function lighting(osm: OsmSignals, darkness: number, vision: Signal<VisionReading> | null): DimensionScore {
  if (osm.coverage === "none") return unmeasured("lighting", OSM_GAP);

  const lampsPerKm2 = perSquareKm(osm.streetLamps, osm.radiusMetres);
  const parts: Array<{ score: number; weight: number }> = [];
  let why = "";

  if (osm.litShare !== null) {
    parts.push({ score: osm.litShare * 100, weight: Math.min(0.55, 0.2 + osm.litSampleSize / 40) });
    why += `${Math.round(osm.litShare * 100)}% of the streets here that record it are mapped as lit (${osm.litSampleSize} streets). `;
  }
  if (osm.streetLamps > 0) {
    parts.push({ score: logistic(lampsPerKm2, 120, 60), weight: 0.35 });
    why += `${osm.streetLamps} street lamps mapped nearby. `;
  }
  if (vision?.available === true && vision.value.lighting !== null) {
    parts.push({ score: vision.value.lighting, weight: Math.min(0.5, vision.confidence) });
    why += `${vision.value.summary} `;
  }

  if (parts.length === 0) {
    return unmeasured(
      "lighting",
      "No street in this area records whether it is lit, and no imagery was available, so lighting was not measured. That is a gap in the data, not a statement about the place.",
    );
  }

  const weight = parts.reduce((sum, part) => sum + part.weight, 0);
  const raw = parts.reduce((sum, part) => sum + part.score * part.weight, 0) / weight;
  // Lighting only matters when it is dark; in daylight it is close to
  // irrelevant, and pretending otherwise makes a 3pm score wrong.
  const score = raw * darkness + (100 - (100 - raw) * 0.25) * (1 - darkness);
  const coveragePenalty = osm.coverage === "partial" ? 0.7 : 1;
  return measured(
    "lighting",
    score,
    Math.min(0.75, weight) * coveragePenalty,
    vision?.available === true ? "model" : "osm",
    why.trim(),
  );
}

export function footTraffic(osm: OsmSignals, localHour: number, darkness: number): DimensionScore {
  if (osm.coverage === "none") return unmeasured("footTraffic", OSM_GAP);
  const venueDensity = perSquareKm(osm.venues, osm.radiusMetres);
  const transitDensity = perSquareKm(osm.transitStops, osm.radiusMetres);
  const base = 0.7 * logistic(venueDensity, 90, 55) + 0.3 * logistic(transitDensity, 25, 15);

  // The shape of a night. 03:00 is not 23:00, and neither is 08:00.
  const hourly =
    localHour >= 7 && localHour < 19
      ? 1
      : localHour >= 19 && localHour < 23
        ? 0.75
        : localHour >= 23 || localHour < 2
          ? 0.45
          : 0.2;
  const score = base * hourly;
  return measured(
    "footTraffic",
    score,
    // This is a model of who is likely about, not a count of anybody. It says
    // so in its confidence.
    osm.coverage === "partial" ? 0.22 : 0.35,
    "model",
    `${osm.venues} venues and ${osm.transitStops} transit stops nearby; modelled for ${String(localHour).padStart(2, "0")}:00${darkness > 0.5 ? " after dark" : ""}.`,
  );
}

export function openVenues(osm: OsmSignals, localHour: number, openNowCount: number | null): DimensionScore {
  if (osm.coverage === "none") return unmeasured("openVenues", OSM_GAP);
  if (openNowCount !== null) {
    return measured(
      "openVenues",
      logistic(openNowCount, 6, 4),
      0.6,
      "point",
      `${openNowCount} venues are open right now within walking distance.`,
    );
  }
  // Without live opening hours this is an estimate from what is here at all,
  // discounted for the hour. Confidence says so.
  const likelyOpenShare = localHour >= 7 && localHour < 22 ? 0.6 : localHour >= 22 || localHour < 2 ? 0.18 : 0.06;
  const estimate = osm.venues * likelyOpenShare;
  return measured(
    "openVenues",
    logistic(estimate, 6, 4),
    0.25,
    "model",
    `${osm.venues} venues are mapped here; roughly ${Math.round(estimate)} would usually be open at this hour. No live opening hours were available.`,
  );
}

export function visibility(osm: OsmSignals, darkness: number): DimensionScore {
  if (osm.coverage === "none") return unmeasured("visibility", OSM_GAP);
  const buildingDensity = perSquareKm(osm.buildings, osm.radiusMetres);
  const openGround = osm.parks + osm.industrial;
  // Enclosed by buildings on a lit street is overlooked; open parkland and
  // industrial edges at night are the opposite of overlooked.
  const enclosure = logistic(buildingDensity, 600, 400);
  const exposure = Math.min(35, openGround * 6) * darkness;
  return measured(
    "visibility",
    enclosure - exposure,
    osm.coverage === "partial" ? 0.2 : 0.3,
    "model",
    `${osm.buildings} buildings and ${openGround} parks or open sites mapped nearby.`,
  );
}

export function refuge(osm: OsmSignals, localHour: number): DimensionScore {
  if (osm.coverage === "none") return unmeasured("refuge", OSM_GAP);
  const nearest = osm.nearestRefugeMetres;
  const nightPenalty = localHour >= 1 && localHour < 6 ? 0.55 : 1;
  const distanceScore = nearest === null ? 0 : 100 * Math.exp(-nearest / 220);
  const countScore = logistic(osm.refuges, 5, 3.5);
  const score = (0.6 * distanceScore + 0.4 * countScore) * nightPenalty;
  return measured(
    "refuge",
    score,
    osm.coverage === "partial" ? 0.25 : 0.4,
    "osm",
    nearest === null
      ? "No shop, bar, hotel or petrol station is mapped within walking distance."
      : `The nearest place you could walk into is about ${Math.round(nearest)} m away; ${osm.refuges} nearby in total.`,
  );
}

export function transitAccess(osm: OsmSignals): DimensionScore {
  if (osm.coverage === "none") return unmeasured("transitAccess", OSM_GAP);
  const nearest = osm.nearestTransitMetres;
  if (nearest === null && osm.transitStops === 0) {
    return measured(
      "transitAccess",
      10,
      osm.coverage === "partial" ? 0.2 : 0.4,
      "osm",
      "No transit stop is mapped within walking distance.",
    );
  }
  const score = nearest === null ? logistic(osm.transitStops, 3, 2) : 100 * Math.exp(-nearest / 400);
  return measured(
    "transitAccess",
    score,
    osm.coverage === "partial" ? 0.25 : 0.45,
    "osm",
    nearest === null
      ? `${osm.transitStops} transit stops nearby.`
      : `The nearest transit stop is about ${Math.round(nearest)} m away.`,
  );
}

export function guardianship(osm: OsmSignals, localHour: number): DimensionScore {
  if (osm.coverage === "none") return unmeasured("guardianship", OSM_GAP);
  const residentialDensity = perSquareKm(osm.residentialBuildings, osm.radiusMetres);
  const groundFloorLife = perSquareKm(osm.venues, osm.radiusMetres);
  const industrialShare = osm.industrial / Math.max(1, osm.buildings + osm.industrial);
  const base = 0.6 * logistic(residentialDensity, 450, 300) + 0.4 * logistic(groundFloorLife, 70, 45);
  const asleep = localHour >= 1 && localHour < 6 ? 0.7 : 1;
  return measured(
    "guardianship",
    base * asleep * (1 - 0.5 * industrialShare),
    osm.coverage === "partial" ? 0.22 : 0.35,
    "model",
    `${osm.residentialBuildings} homes and ${osm.venues} ground-floor venues overlook this area.`,
  );
}

export function walkability(osm: OsmSignals): DimensionScore {
  if (osm.coverage === "none") return unmeasured("walkability", OSM_GAP);
  if (osm.highways === 0) {
    return unmeasured(
      "walkability",
      "No streets were returned for this area, so how walkable it is was not measured. That is a gap in the data, not a statement about the place.",
    );
  }
  const footwayShare = osm.footways / osm.highways;
  const score = 100 * Math.min(1, footwayShare * 1.6) * 0.7 + logistic(osm.crossings, 6, 4) * 0.3;
  return measured(
    "walkability",
    score,
    osm.coverage === "partial" ? 0.2 : 0.35,
    "osm",
    `${osm.footways} of ${osm.highways} mapped ways here are footpaths, with ${osm.crossings} marked crossings.`,
  );
}

export function environment(weather: Signal<WeatherNow>, darkness: number): DimensionScore {
  if (!weather.available) {
    // Darkness is computed offline and never fails, so the dimension can still
    // be reported — at the lower confidence of having only half the picture.
    return measured(
      "environment",
      100 - darkness * 45,
      0.3,
      "computed",
      darkness > 0.7
        ? "It is dark here now. No weather data was available."
        : "It is light here now. No weather data was available.",
    );
  }
  const weatherNow = weather.value;
  const rain = weatherNow.precipitationMm ?? 0;
  const wind = weatherNow.windSpeedKph ?? 0;
  const score = 100 - darkness * 40 - Math.min(25, rain * 12) - Math.min(10, Math.max(0, wind - 35) / 3);
  return measured(
    "environment",
    score,
    weather.confidence,
    "computed",
    `${darkness > 0.7 ? "Dark" : darkness > 0.2 ? "Twilight" : "Daylight"}, ${weatherNow.temperatureC ?? "?"}°C${rain > 0 ? `, ${rain} mm of rain` : ""}.`,
  );
}
