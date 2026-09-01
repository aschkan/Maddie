/**
 * Safety-ranked place search.
 *
 * The ranking is not "is this a good coffee shop". It is: if you go there at
 * this hour, what is the walk like, is it overlooked, is anything else open,
 * and could you get away.
 *
 * The failure mode this file exists to prevent: an empty list that looks like
 * "there is nothing here" when the truth is "no map data arrived". Those are
 * opposite claims and they look identical on a screen, so the result always
 * carries the coverage it was built from.
 */
import { getConfig } from "../config.ts";
import { bboxAround, haversineMetres } from "../geo/distance.ts";
import type { LatLng } from "../geo/wkt.ts";
import { overpassBatch, venueQuery, type OsmFeature } from "../sources/overpass.ts";
import { fetchWeather, timezoneFor, type WeatherNow } from "../sources/weather.ts";
import { reportsNear } from "../store/repositories.ts";
import { summariseOsm } from "./osm.ts";
import { darkness as darknessAt, localHour as localHourAt } from "./sun.ts";
import { areaQuery } from "../sources/overpass.ts";
import { band, combine, type SafetyBand } from "./assess.ts";
import {
  DIMENSION_ORDER,
  environment,
  footTraffic,
  guardianship,
  lighting,
  openVenues,
  refuge,
  transitAccess,
  visibility,
  walkability,
  harassmentSignals,
  incidentHistory,
  type DimensionScore,
} from "./dimensions.ts";
import { absent, type Signal } from "../signal.ts";
import type { CrimeSummary } from "../sources/nl-crime.ts";
import { fetchAreaCrime, fetchAreaNuisance } from "../sources/nl-crime.ts";
import { areaForPoint } from "../sources/geocode.ts";

export interface VenueCategory {
  id: string;
  label: string;
  keywords: string[];
  filters: string[];
}

/** The things people actually search for at the hour they search for them. */
export const CATEGORIES: VenueCategory[] = [
  {
    id: "pharmacy",
    label: "Pharmacy",
    keywords: ["pharmacy", "apotheek", "chemist", "medicine", "paracetamol", "drogist"],
    filters: ['["amenity"="pharmacy"]', '["healthcare"="pharmacy"]', '["shop"="chemist"]'],
  },
  {
    id: "late-food",
    label: "Late food",
    keywords: ["late food", "food", "eat", "restaurant", "takeaway", "snack", "night food", "hungry"],
    filters: ['["amenity"~"^(fast_food|restaurant|cafe)$"]'],
  },
  {
    id: "convenience",
    label: "Shop open now",
    keywords: ["shop", "supermarket", "convenience", "groceries", "avondwinkel", "night shop"],
    filters: ['["shop"~"^(convenience|supermarket|kiosk)$"]'],
  },
  {
    id: "transit",
    label: "Way home",
    keywords: ["station", "tram", "metro", "bus", "train", "transit", "way home", "get home"],
    filters: ['["railway"~"^(station|tram_stop|halt)$"]', '["highway"="bus_stop"]', '["amenity"="taxi"]'],
  },
  {
    id: "help",
    label: "Somewhere to get help",
    keywords: ["police", "hospital", "help", "emergency", "safe place", "politie", "ziekenhuis"],
    filters: ['["amenity"~"^(police|hospital|clinic|fire_station)$"]'],
  },
  {
    id: "toilet",
    label: "Toilet",
    keywords: ["toilet", "wc", "bathroom", "restroom"],
    filters: ['["amenity"="toilets"]'],
  },
  {
    id: "cafe",
    label: "Somewhere to sit",
    keywords: ["cafe", "coffee", "bar", "pub", "sit", "wait", "warm"],
    filters: ['["amenity"~"^(cafe|bar|pub)$"]'],
  },
  {
    id: "fuel",
    label: "Petrol station",
    keywords: ["petrol", "fuel", "gas station", "tankstation", "24h"],
    filters: ['["amenity"="fuel"]'],
  },
];

export function resolveCategory(query: string): VenueCategory | null {
  const text = query.trim().toLowerCase();
  if (text === "") return null;
  let best: { category: VenueCategory; score: number } | null = null;
  for (const category of CATEGORIES) {
    for (const keyword of category.keywords) {
      if (!text.includes(keyword)) continue;
      const score = keyword.length;
      if (best === null || score > best.score) best = { category, score };
    }
  }
  return best?.category ?? null;
}

export interface RankedPlace {
  id: string;
  name: string;
  kind: string;
  point: LatLng;
  distanceMetres: number;
  score: number | null;
  confidence: number;
  band: SafetyBand;
  openNow: boolean | null;
  openingHours: string | null;
  dimensions: DimensionScore[];
  gaps: string[];
}

export interface PlaceSearchResult {
  query: string;
  category: VenueCategory | null;
  centre: LatLng;
  at: string;
  timezone: string;
  localHour: number;
  darkness: number;
  radiusMetres: number;
  /**
   * The whole point: "measured" with an empty list means there is genuinely
   * nothing here. "none" means we could not look, and the surface must say so
   * instead of showing an empty state.
   */
  coverage: "measured" | "partial" | "none";
  places: RankedPlace[];
  gaps: string[];
  note: string | null;
}

function nameOf(feature: OsmFeature): string {
  return feature.tags.name ?? feature.tags["name:nl"] ?? feature.tags.brand ?? feature.tags.operator ?? "Unnamed";
}

function kindOf(feature: OsmFeature): string {
  return feature.tags.amenity ?? feature.tags.shop ?? feature.tags.railway ?? feature.tags.highway ?? "place";
}

export interface SearchOptions {
  query: string;
  centre: LatLng;
  at?: Date;
  radiusMetres?: number;
  limit?: number;
}

export async function searchPlaces(options: SearchOptions): Promise<PlaceSearchResult> {
  const config = getConfig();
  const at = options.at ?? new Date();
  const radiusMetres = options.radiusMetres ?? 900;
  const limit = options.limit ?? 12;
  const timezone = timezoneFor(options.centre);
  const hour = localHourAt(at, timezone);
  const dark = darknessAt(at, options.centre);
  const category = resolveCategory(options.query);

  const box = bboxAround(options.centre, radiusMetres);
  const filters =
    category?.filters ??
    (options.query.trim() === ""
      ? ['["amenity"]', '["shop"]']
      : [`["name"~"${options.query.trim().replace(/["\\~]/g, "")}",i]`]);

  // Two queries under ONE deadline: the venues themselves, and the street
  // furniture every score is built from.
  const batch = await overpassBatch([venueQuery(box, filters), areaQuery(box)]);
  const coverage = batch.succeeded === 0 ? "none" : batch.failed > 0 ? "partial" : "measured";

  if (coverage === "none") {
    return {
      query: options.query,
      category,
      centre: options.centre,
      at: at.toISOString(),
      timezone,
      localHour: hour,
      darkness: dark,
      radiusMetres,
      coverage,
      places: [],
      gaps: batch.notes,
      note: "No map data could be loaded, so nothing was searched. This is not a claim that there is nothing here.",
    };
  }

  const candidates = batch.features.filter((feature) => {
    if (feature.point === null) return false;
    if (haversineMetres(options.centre, feature.point) > radiusMetres) return false;
    if (category === null) return typeof feature.tags.name === "string";
    // Re-check locally: the area query returns everything, and only the venue
    // query was filtered.
    return matchesCategory(feature, category);
  });

  const weather = await fetchWeather(options.centre);
  const seen = new Set<string>();
  const ranked: RankedPlace[] = [];

  for (const feature of candidates) {
    const key = `${nameOf(feature)}@${feature.point!.lat.toFixed(4)},${feature.point!.lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(await rankOne(feature, batch.features, coverage, at, timezone, weather, dark, hour, options.centre));
    if (ranked.length >= limit * 2) break;
  }

  ranked.sort((left, right) => (right.score ?? -1) - (left.score ?? -1));
  const places = ranked.slice(0, limit);

  return {
    query: options.query,
    category,
    centre: options.centre,
    at: at.toISOString(),
    timezone,
    localHour: hour,
    darkness: dark,
    radiusMetres,
    coverage,
    places,
    gaps: [...new Set([...batch.notes, ...places.flatMap((place) => place.gaps)])],
    note:
      places.length === 0
        ? `The map data loaded, and nothing matching "${options.query}" is mapped within ${radiusMetres} m. That is a real answer, not a failure.`
        : config.googleMapsKey === ""
          ? "No Google Places key is configured, so nothing is known here about how staff treat women on their own. That is a gap in the data, not a statement about these places."
          : null,
  };
}

function matchesCategory(feature: OsmFeature, category: VenueCategory): boolean {
  const tags = feature.tags;
  switch (category.id) {
    case "pharmacy":
      return tags.amenity === "pharmacy" || tags.healthcare === "pharmacy" || tags.shop === "chemist";
    case "late-food":
      return ["fast_food", "restaurant", "cafe"].includes(tags.amenity ?? "");
    case "convenience":
      return ["convenience", "supermarket", "kiosk"].includes(tags.shop ?? "");
    case "transit":
      return (
        ["station", "tram_stop", "halt"].includes(tags.railway ?? "") ||
        tags.highway === "bus_stop" ||
        tags.amenity === "taxi"
      );
    case "help":
      return ["police", "hospital", "clinic", "fire_station"].includes(tags.amenity ?? "");
    case "toilet":
      return tags.amenity === "toilets";
    case "cafe":
      return ["cafe", "bar", "pub"].includes(tags.amenity ?? "");
    case "fuel":
      return tags.amenity === "fuel";
    default:
      return false;
  }
}

async function rankOne(
  feature: OsmFeature,
  allFeatures: readonly OsmFeature[],
  coverage: "measured" | "partial" | "none",
  at: Date,
  timezone: string,
  weather: Signal<WeatherNow>,
  dark: number,
  hour: number,
  origin: LatLng,
): Promise<RankedPlace> {
  const point = feature.point!;
  const radius = 250;
  const nearby = allFeatures.filter(
    (candidate) => candidate.point !== null && haversineMetres(point, candidate.point) <= radius * 1.4,
  );
  const osm = summariseOsm(nearby, point, radius, coverage);

  const config = getConfig();
  const located = await areaForPoint(point);
  let crime: Signal<CrimeSummary>;
  let nuisance: Signal<CrimeSummary>;
  if (located.area === null) {
    const note =
      located.note ??
      "No CBS neighbourhood could be resolved here, so the police figures were not looked up. That is a gap in the data, not a statement about the place.";
    crime = absent("no-coverage", `CBS StatLine ${config.crimeTable}`, note);
    nuisance = absent("no-coverage", "CBS StatLine 47024NED", note);
  } else {
    [crime, nuisance] = await Promise.all([
      fetchAreaCrime({ area: located.area, now: at }),
      fetchAreaNuisance({ area: located.area, now: at }),
    ]);
  }
  const reports = await reportsNear(point, radius);

  const dimensions: DimensionScore[] = [
    lighting(osm, dark, null),
    footTraffic(osm, hour, dark),
    openVenues(osm, hour, null),
    visibility(osm, dark),
    refuge(osm, hour),
    transitAccess(osm),
    guardianship(osm, hour),
    walkability(osm),
    incidentHistory(crime),
    harassmentSignals(nuisance, crime, reports, null),
    environment(weather, dark),
  ];
  const ordered = DIMENSION_ORDER.map((key) => dimensions.find((dimension) => dimension.key === key)!);
  const combined = combine(ordered);

  const gaps: string[] = [];
  if (!crime.available) gaps.push(crime.note);

  return {
    id: feature.id,
    name: nameOf(feature),
    kind: kindOf(feature),
    point,
    distanceMetres: Math.round(haversineMetres(origin, point)),
    score: combined.score,
    confidence: combined.confidence,
    band: band(combined.score, combined.confidence),
    // OSM opening hours are a string, not a schedule engine. Reporting the raw
    // string is honest; parsing it badly is not.
    openNow: null,
    openingHours: feature.tags.opening_hours ?? null,
    dimensions: ordered,
    gaps,
  };
}
