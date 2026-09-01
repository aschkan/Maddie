import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseAreaCode, parsePdokResponse, mostSpecificArea } from "../src/lib/sources/pdok.ts";
import { parseNominatim } from "../src/lib/sources/nominatim.ts";
import { parseValhalla, kilometresToMetres } from "../src/lib/sources/valhalla.ts";
import { parseOverpass, areaQuery, venueQuery } from "../src/lib/sources/overpass.ts";
import { parseForecast, timezoneFor } from "../src/lib/sources/weather.ts";
import { parseMapillary } from "../src/lib/sources/mapillary.ts";
import { parsePlaces, parseReviews } from "../src/lib/sources/google-places.ts";
import { summariseOsm } from "../src/lib/scoring/osm.ts";
import { haversineMetres } from "../src/lib/geo/distance.ts";
import { resolveCategory } from "../src/lib/scoring/places.ts";

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const AMSTERDAM = { lat: 52.3728, lng: 4.8936 };

test("PDOK gives back CBS neighbourhood codes, most specific first", () => {
  const places = parsePdokResponse(read("pdok-free.json"));
  assert.equal(places.length, 2);
  const first = places[0]!;
  // POINT(lon lat): the longitude is 4.89, not 52.37.
  assert.ok(Math.abs(first.point.lat - 52.373055) < 1e-9);
  assert.ok(Math.abs(first.point.lng - 4.893604) < 1e-9);
  assert.deepEqual(
    first.areas.map((area) => area.code),
    ["BU03630000", "WK036300", "GM0363"],
  );
  assert.equal(mostSpecificArea(first)?.level, "buurt");
  assert.equal(first.postcode, "1012JS");
});

test("a bare gemeente number is normalised to GM####", () => {
  assert.equal(normaliseAreaCode("gemeente", "0363"), "GM0363");
  assert.equal(normaliseAreaCode("gemeente", "GM0363"), "GM0363");
  assert.equal(normaliseAreaCode("gemeente", "363"), "GM0363");
  assert.equal(normaliseAreaCode("wijk", "WK036300"), "WK036300");
  assert.equal(normaliseAreaCode("buurt", "BU03630000"), "BU03630000");
  assert.equal(normaliseAreaCode("buurt", "not a code"), null);
  assert.equal(normaliseAreaCode("buurt", undefined), null);
});

test("Nominatim results carry no CBS codes, and say so by having none", () => {
  const places = parseNominatim(read("nominatim-search.json"));
  assert.equal(places.length, 1);
  assert.equal(places[0]!.source, "nominatim");
  assert.deepEqual(places[0]!.areas, []);
  assert.ok(Math.abs(places[0]!.point.lat - 52.3730796) < 1e-7);
  assert.equal(places[0]!.municipality, "Amsterdam");
});

test("Valhalla: precision 6 shape, and length in kilometres", () => {
  const routes = parseValhalla(read("valhalla-route.json"));
  assert.equal(routes.length, 1);
  const route = routes[0]!;
  assert.equal(route.points.length, 4);
  // The fixture's shape was encoded by an independent implementation.
  assert.ok(haversineMetres(route.points[0]!, { lat: 52.3728, lng: 4.8936 }) < 1, JSON.stringify(route.points[0]));
  assert.ok(haversineMetres(route.points[3]!, { lat: 52.3739, lng: 4.899 }) < 1);
  // 0.394 km is 394 m, not 0.394 m.
  assert.equal(route.distanceMetres, kilometresToMetres(0.394));
  assert.ok(route.distanceMetres > 300 && route.distanceMetres < 500);
  assert.equal(route.durationSeconds, 296);
});

test("Overpass elements reduce to the counts the dimensions read", () => {
  const features = parseOverpass(read("overpass-area.json"));
  assert.equal(features.length, 15);
  const osm = summariseOsm(features, AMSTERDAM, 300, "measured");
  assert.equal(osm.streetLamps, 3);
  assert.equal(osm.highways, 3);
  assert.equal(osm.footways, 1);
  assert.equal(osm.litSampleSize, 3);
  assert.ok(Math.abs(osm.litShare! - 2 / 3) < 1e-9);
  assert.equal(osm.venues, 3);
  assert.equal(osm.refuges, 3);
  assert.equal(osm.transitStops, 2);
  assert.equal(osm.buildings, 2);
  assert.equal(osm.residentialBuildings, 2);
  assert.equal(osm.parks, 1);
  assert.equal(osm.emergencyPoints, 1);
  assert.ok(osm.nearestTransitMetres !== null && osm.nearestTransitMetres < 200);
});

test("Overpass QL is built with the bbox in south,west,north,east order", () => {
  const ql = areaQuery({ south: 52.37, west: 4.89, north: 52.375, east: 4.9 });
  assert.ok(ql.includes("(52.37,4.89,52.375,4.9)"));
  assert.ok(ql.startsWith("[out:json][timeout:25];"));
  assert.ok(ql.includes("out center tags"));
  const venues = venueQuery({ south: 52.37, west: 4.89, north: 52.375, east: 4.9 }, ['["amenity"="pharmacy"]']);
  assert.ok(venues.includes('node["amenity"="pharmacy"](52.37,4.89,52.375,4.9);'));
  assert.ok(venues.includes('way["amenity"="pharmacy"](52.37,4.89,52.375,4.9);'));
});

test("Open-Meteo parses, and the timezone comes from the offline table", () => {
  const timezone = timezoneFor(AMSTERDAM);
  assert.equal(timezone, "Europe/Amsterdam");
  const weather = parseForecast(read("open-meteo.json"), timezone);
  assert.ok(weather);
  assert.equal(weather.temperatureC, 14.2);
  assert.equal(weather.precipitationMm, 0.4);
  assert.equal(weather.isDay, false);
  assert.equal(weather.sunset, "2026-08-30T20:38");
});

test("Mapillary geometry is [lon, lat], and images without a URL are dropped", () => {
  const images = parseMapillary(read("mapillary-images.json"));
  assert.equal(images.length, 2);
  assert.ok(Math.abs(images[0]!.point!.lat - 52.37301) < 1e-9);
  assert.ok(Math.abs(images[0]!.point!.lng - 4.89365) < 1e-9);
  assert.equal(images[0]!.headingDegrees, 137.5);
  assert.equal(images[0]!.provider, "mapillary");
});

test("Google Places parses, and reviews keep the text that matters", () => {
  const places = parsePlaces(read("google-places.json"));
  assert.equal(places.length, 1);
  assert.equal(places[0]!.name, "Apotheek Damstraat");
  assert.equal(places[0]!.openNow, true);
  assert.ok(Math.abs(places[0]!.point!.lng - 4.8949) < 1e-9);

  const reviews = parseReviews(read("google-reviews.json"));
  // The third review has no text at all and is not a data point.
  assert.equal(reviews.length, 2);
  assert.match(reviews[0]!.text, /came straight out and stood with me/);
  assert.equal(reviews[1]!.text, "Rij was lang en het personeel was onvriendelijk.");
});

test("plain-language searches resolve to venue categories", () => {
  assert.equal(resolveCategory("pharmacy")?.id, "pharmacy");
  assert.equal(resolveCategory("somewhere to get paracetamol")?.id, "pharmacy");
  assert.equal(resolveCategory("late food")?.id, "late-food");
  assert.equal(resolveCategory("way home")?.id, "transit");
  assert.equal(resolveCategory("police")?.id, "help");
  assert.equal(resolveCategory("zzzz"), null);
});
