import test from "node:test";
import assert from "node:assert/strict";

import { fetchRoute, parseRoute, routeUrl } from "../src/lib/osrm.ts";
import { parsePlaces, searchPlaces } from "../src/lib/geocode.ts";
import { formatDistance, formatDuration } from "../src/lib/format.ts";

const AMSTERDAM = { lat: 52.3728, lng: 4.8936 };
const DAM_SQUARE = { lat: 52.3731, lng: 4.8926 };

/* --------------------------------- the URL --------------------------------- */

test("coordinates go to OSRM as lon,lat — not the lat,lng Leaflet uses", () => {
  const url = routeUrl(AMSTERDAM, DAM_SQUARE);
  // The whole trap in one assertion. Sent the other way round this still
  // returns a route, just one near Somalia, and nothing errors.
  assert.ok(
    url.includes("/4.8936,52.3728;4.8926,52.3731"),
    `longitude must come first, got: ${url}`,
  );
});

test("the request asks for a full GeoJSON line", () => {
  const url = routeUrl(AMSTERDAM, DAM_SQUARE);
  // Without overview=full the geometry is simplified to a handful of points
  // and the line visibly cuts corners; without geojson it is an encoded
  // polyline this app does not decode.
  assert.match(url, /overview=full/);
  assert.match(url, /geometries=geojson/);
});

test("our profile names map to OSRM's", () => {
  assert.match(routeUrl(AMSTERDAM, DAM_SQUARE, "walking"), /\/route\/v1\/foot\//);
  assert.match(routeUrl(AMSTERDAM, DAM_SQUARE, "cycling"), /\/route\/v1\/bike\//);
  assert.match(routeUrl(AMSTERDAM, DAM_SQUARE, "driving"), /\/route\/v1\/driving\//);
});

test("a custom base URL is used, with any trailing slash tolerated", () => {
  const url = routeUrl(AMSTERDAM, DAM_SQUARE, "driving", "http://127.0.0.1:5000/");
  assert.ok(url.startsWith("http://127.0.0.1:5000/route/v1/"), url);
  assert.ok(!url.includes("//route"), "a trailing slash must not double up");
});

/* ------------------------------- the response ------------------------------- */

const OK_REPLY = {
  code: "Ok",
  routes: [{
    distance: 1234.5,
    duration: 300.2,
    geometry: { coordinates: [[4.8936, 52.3728], [4.8930, 52.3730], [4.8926, 52.3731]] },
  }],
};

test("a route comes back flipped into Leaflet's lat,lng order", () => {
  const result = parseRoute(OK_REPLY);
  assert.ok(result.ok);
  assert.equal(result.route.path.length, 3);
  // GeoJSON gave [4.8936, 52.3728]; Leaflet needs {lat: 52.37, lng: 4.89}.
  assert.deepEqual(result.route.path[0], { lat: 52.3728, lng: 4.8936 });
  assert.equal(result.route.metres, 1234.5);
  assert.equal(result.route.seconds, 300.2);
});

test("NoRoute is explained, not shown as a raw code", () => {
  const result = parseRoute({ code: "NoRoute", message: "Impossible route" });
  assert.ok(!result.ok);
  assert.match(result.error, /No route between those two points/);
});

test("a failure code with a 200 body is still a failure", () => {
  // OSRM reports errors in the body with an HTTP 200, so the status alone
  // never tells you whether there is a route.
  const result = parseRoute({ code: "InvalidQuery", message: "Query string malformed" });
  assert.ok(!result.ok);
  assert.match(result.error, /malformed/);
});

test("nonsense in place of a reply is refused rather than crashing", () => {
  for (const bad of [null, undefined, 42, "Ok", [], {}, { code: "Ok", routes: [] }]) {
    const result = parseRoute(bad);
    assert.ok(!result.ok, `should refuse: ${JSON.stringify(bad)}`);
    assert.ok(result.error.length > 0);
  }
});

test("a line of one point is refused — it cannot be drawn", () => {
  const result = parseRoute({
    code: "Ok",
    routes: [{ distance: 0, duration: 0, geometry: { coordinates: [[4.89, 52.37]] } }],
  });
  assert.ok(!result.ok);
});

test("malformed points are dropped, and the rest of the route survives", () => {
  const result = parseRoute({
    code: "Ok",
    routes: [{
      distance: 10,
      duration: 5,
      geometry: {
        coordinates: [
          [4.8936, 52.3728],
          ["nope", 52.373],          // a string where a number belongs
          [4.893],                    // missing its latitude
          null,
          [Number.NaN, 52.374],
          [4.8926, 52.3731],
        ],
      },
    }],
  });
  assert.ok(result.ok);
  assert.equal(result.route.path.length, 2, "only the two usable points remain");
});

test("distance and duration missing from a valid route default to zero, not NaN", () => {
  // NaN renders as "NaN km" on the page, which looks like a bug in the map
  // rather than a gap in the answer.
  const result = parseRoute({
    code: "Ok",
    routes: [{ geometry: { coordinates: [[4.89, 52.37], [4.90, 52.38]] } }],
  });
  assert.ok(result.ok);
  assert.equal(result.route.metres, 0);
  assert.equal(result.route.seconds, 0);
});

/* -------------------------------- geocoding -------------------------------- */

test("Nominatim's string coordinates are parsed as numbers", () => {
  const places = parsePlaces([
    { lat: "52.3730796", lon: "4.8924534", display_name: "Dam, Amsterdam" },
  ]);
  assert.equal(places.length, 1);
  assert.equal(places[0]?.point.lat, 52.3730796);
  assert.equal(places[0]?.point.lng, 4.8924534);
});

test("an unparseable hit is dropped rather than becoming 0,0", () => {
  // Number("") is 0, and 0,0 is a real place in the Gulf of Guinea — a silent
  // wrong answer instead of a visible missing one.
  const places = parsePlaces([
    { lat: "", lon: "", display_name: "empty" },
    { lat: "abc", lon: "4.89", display_name: "not a number" },
    { lat: "91", lon: "4.89", display_name: "off the planet" },
    { lat: "52.37", lon: "4.89", display_name: "fine" },
  ]);
  assert.equal(places.length, 1);
  assert.equal(places[0]?.label, "fine");
});

test("a non-array reply is an empty list, not a crash", () => {
  for (const bad of [null, undefined, {}, "error", 7]) {
    assert.deepEqual(parsePlaces(bad), []);
  }
});

/* -------------------------------- formatting -------------------------------- */

test("distances read the way a person would say them", () => {
  assert.equal(formatDistance(420), "420 m");
  assert.equal(formatDistance(999), "999 m");
  assert.equal(formatDistance(1000), "1.0 km");
  assert.equal(formatDistance(9449), "9.4 km");
  assert.equal(formatDistance(23_700), "24 km");
});

test("durations read the way a person would say them", () => {
  assert.equal(formatDuration(20), "under a minute");
  assert.equal(formatDuration(300), "5 min");
  assert.equal(formatDuration(3600), "1 h");
  assert.equal(formatDuration(4500), "1 h 15 min");
});

test("a missing number shows a dash, never NaN", () => {
  assert.equal(formatDistance(Number.NaN), "—");
  assert.equal(formatDuration(Number.NaN), "—");
  assert.equal(formatDistance(-1), "—");
});

/* ------------------------- what a failure says to you ------------------------ */

test("a 400 on walk or cycle explains the demo server's limits, not just the number", async () => {
  // The public OSRM demo server has not consistently carried the foot and bike
  // profiles. A bare "answered 400" reads as a broken app rather than as a
  // limit of a free service you can replace.
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 400 })) as typeof fetch;
  try {
    const walk = await fetchRoute(AMSTERDAM, DAM_SQUARE, "walking");
    assert.ok(!walk.ok);
    assert.match(walk.error, /walking route/);
    assert.match(walk.error, /OSRM_URL|own server/);

    // Driving is the profile it always serves, so a 400 there means something
    // else and must not be blamed on the profile.
    const drive = await fetchRoute(AMSTERDAM, DAM_SQUARE, "driving");
    assert.ok(!drive.ok);
    assert.doesNotMatch(drive.error, /profile/);
  } finally {
    globalThis.fetch = original;
  }
});

test("rate limiting says to wait, rather than showing a 429", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 429 })) as typeof fetch;
  try {
    const result = await fetchRoute(AMSTERDAM, DAM_SQUARE);
    assert.ok(!result.ok);
    assert.match(result.error, /rate limiting/);
  } finally {
    globalThis.fetch = original;
  }
});

test("an aborted request is not shown to the user as a failure", async () => {
  // Changing the destination cancels the request for the old one. That is the
  // app working, and showing an error for it would be noise on every edit.
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new DOMException("aborted", "AbortError"); }) as typeof fetch;
  try {
    const result = await fetchRoute(AMSTERDAM, DAM_SQUARE);
    assert.ok(!result.ok);
    assert.equal(result.error, "cancelled");
  } finally {
    globalThis.fetch = original;
  }
});

test("an unreachable routing service says so plainly", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  try {
    const result = await fetchRoute(AMSTERDAM, DAM_SQUARE);
    assert.ok(!result.ok);
    assert.match(result.error, /Could not reach the routing service/);
  } finally {
    globalThis.fetch = original;
  }
});

/* ------------------------- address search failures ------------------------- */

test("a search that could not run is told apart from one that found nothing", async () => {
  // Both used to be an empty array, so a blocked or slow Nominatim looked
  // exactly like a typo — and you would sit retyping an address that was fine.
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  try {
    const outcome = await searchPlaces("Dam Amsterdam");
    assert.deepEqual(outcome.places, []);
    assert.match(outcome.error ?? "", /could not be reached/);
  } finally {
    globalThis.fetch = original;
  }
});

test("finding nothing is not reported as a failure", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("[]", { status: 200 })) as typeof fetch;
  try {
    const outcome = await searchPlaces("qwertyuiop nowhere");
    assert.deepEqual(outcome.places, []);
    assert.equal(outcome.error, undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test("an aborted search is silent — we replaced the request", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new DOMException("aborted", "AbortError"); }) as typeof fetch;
  try {
    const outcome = await searchPlaces("Dam Amsterdam");
    assert.equal(outcome.error, undefined);
  } finally {
    globalThis.fetch = original;
  }
});
