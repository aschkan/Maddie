/**
 * What OpenStreetMap can tell us about a place, reduced to the handful of
 * counts the dimensions actually read.
 *
 * `coverage` is load-bearing: an empty result from a working Overpass and an
 * empty result because no Overpass answered are opposite claims, and this is
 * where they are kept apart.
 */
import type { OsmFeature } from "../sources/overpass.ts";
import { haversineMetres } from "../geo/distance.ts";
import type { LatLng } from "../geo/wkt.ts";

export type OsmCoverage = "measured" | "partial" | "none";

export interface OsmSignals {
  coverage: OsmCoverage;
  radiusMetres: number;
  streetLamps: number;
  /** Ways carrying `lit=yes` as a share of ways that say anything about lit. */
  litShare: number | null;
  litSampleSize: number;
  highways: number;
  footways: number;
  crossings: number;
  venues: number;
  /** Venues plausibly open around the clock — the places you can walk into. */
  refuges: number;
  transitStops: number;
  buildings: number;
  residentialBuildings: number;
  parks: number;
  industrial: number;
  emergencyPoints: number;
  nearestTransitMetres: number | null;
  nearestRefugeMetres: number | null;
}

const REFUGE_AMENITIES = new Set([
  "hospital",
  "clinic",
  "police",
  "fire_station",
  "fuel",
  "pharmacy",
  "bar",
  "pub",
  "restaurant",
  "cafe",
  "fast_food",
  "hotel",
  "bus_station",
  "taxi",
]);

const REFUGE_SHOPS = new Set(["convenience", "supermarket", "kiosk", "chemist"]);

export function summariseOsm(
  features: readonly OsmFeature[],
  centre: LatLng,
  radiusMetres: number,
  coverage: OsmCoverage,
): OsmSignals {
  const signals: OsmSignals = {
    coverage,
    radiusMetres,
    streetLamps: 0,
    litShare: null,
    litSampleSize: 0,
    highways: 0,
    footways: 0,
    crossings: 0,
    venues: 0,
    refuges: 0,
    transitStops: 0,
    buildings: 0,
    residentialBuildings: 0,
    parks: 0,
    industrial: 0,
    emergencyPoints: 0,
    nearestTransitMetres: null,
    nearestRefugeMetres: null,
  };

  let litYes = 0;
  let litKnown = 0;

  const closer = (current: number | null, candidate: number): number =>
    current === null ? candidate : Math.min(current, candidate);

  for (const feature of features) {
    const tags = feature.tags;
    const distance = feature.point === null ? null : haversineMetres(centre, feature.point);
    if (distance !== null && distance > radiusMetres * 1.6) continue;

    if (tags.highway === "street_lamp") signals.streetLamps += 1;
    if (tags.highway === "crossing" || tags.footway === "crossing") signals.crossings += 1;

    if (typeof tags.highway === "string" && feature.kind === "way") {
      signals.highways += 1;
      if (["footway", "path", "pedestrian", "living_street", "steps"].includes(tags.highway)) {
        signals.footways += 1;
      }
      if (typeof tags.lit === "string") {
        litKnown += 1;
        if (tags.lit !== "no" && tags.lit !== "disused") litYes += 1;
      }
    }

    const amenity = tags.amenity;
    const shop = tags.shop;
    if (typeof amenity === "string" || typeof shop === "string") {
      signals.venues += 1;
      const isRefuge =
        (typeof amenity === "string" && REFUGE_AMENITIES.has(amenity)) ||
        (typeof shop === "string" && REFUGE_SHOPS.has(shop)) ||
        tags.tourism === "hotel";
      if (isRefuge) {
        signals.refuges += 1;
        if (distance !== null) signals.nearestRefugeMetres = closer(signals.nearestRefugeMetres, distance);
      }
    }

    if (
      tags.public_transport === "stop_position" ||
      tags.highway === "bus_stop" ||
      ["station", "tram_stop", "halt"].includes(tags.railway ?? "")
    ) {
      signals.transitStops += 1;
      if (distance !== null) signals.nearestTransitMetres = closer(signals.nearestTransitMetres, distance);
    }

    if (typeof tags.building === "string") {
      signals.buildings += 1;
      if (["residential", "apartments", "house", "terrace", "dormitory", "yes"].includes(tags.building)) {
        signals.residentialBuildings += 1;
      }
    }

    if (tags.leisure === "park") signals.parks += 1;
    if (["industrial", "brownfield", "farmland", "forest"].includes(tags.landuse ?? "")) signals.industrial += 1;
    if (tags.emergency === "phone" || tags.emergency === "assembly_point") signals.emergencyPoints += 1;
  }

  signals.litSampleSize = litKnown;
  signals.litShare = litKnown >= 3 ? litYes / litKnown : null;
  return signals;
}

/** Features per square kilometre, so counts from different radii compare. */
export function perSquareKm(count: number, radiusMetres: number): number {
  const areaKm2 = (Math.PI * radiusMetres ** 2) / 1_000_000;
  return areaKm2 <= 0 ? 0 : count / areaKm2;
}
