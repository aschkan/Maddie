import test from "node:test";
import assert from "node:assert/strict";

import {
  FORWARD, OWN_API, PUBLIC, forwarderFailure, resolve, unreachableMessage,
  type MapService,
} from "../src/lib/endpoints.ts";
import { SERVICES, upstreamUrl } from "../src/lib/osm-forward.ts";

const ALL: MapService[] = ["overpass", "osrm", "nominatim", "tile"];

/** `SERVICES` is indexed by a plain string, so it is optional to the compiler. */
function service(name: string) {
  const found = SERVICES[name];
  assert.ok(found, `no such forwarded service: ${name}`);
  return found;
}

/* ------------------------------ which way out ------------------------------ */

test("by default every map request goes through THIS server", () => {
  // The whole point: the domain answers from two machines and only one of them
  // can reach OpenStreetMap. The server is the one thing certainly reachable —
  // the page came from it.
  for (const service of ALL) {
    const url = resolve(service);
    assert.ok(url.startsWith("/api/osm/"), `${service} resolved to ${url}`);
  }
});

test("the direct escape hatch sends the browser straight out again", () => {
  for (const service of ALL) {
    assert.equal(resolve(service, { direct: "1" }), PUBLIC[service]);
  }
  assert.equal(resolve("tile", { direct: "true" }), PUBLIC.tile);
  assert.equal(resolve("tile", { direct: "yes" }), PUBLIC.tile);
});

test("anything else in that variable is not a yes", () => {
  // A half-set flag must not silently disable the forwarder.
  for (const value of ["0", "false", "no", "", "  ", "maybe", undefined]) {
    assert.equal(resolve("tile", { direct: value }), FORWARD.tile, `"${value}" should not flip it`);
  }
});

test("a named upstream beats both — that is how you point at your own OSRM", () => {
  assert.equal(resolve("osrm", { explicit: "http://10.0.0.9:5000" }), "http://10.0.0.9:5000");
  // Even with the direct flag set: naming one is the more specific instruction.
  assert.equal(
    resolve("overpass", { explicit: "http://10.0.0.9/api/interpreter", direct: "1" }),
    "http://10.0.0.9/api/interpreter",
  );
  // Whitespace is not a URL.
  assert.equal(resolve("osrm", { explicit: "   " }), FORWARD.osrm);
});

/* -------------------- this app's own API is never proxied ------------------- */

test("no map service is ever pointed at this app's own API", () => {
  // The rule stated from this side. `/api/assess` and `/api/reports` are
  // same-origin calls to the box that served the page: there is nothing to
  // reach around, and putting a proxy chain in front of a loopback call adds
  // hops and failure modes to something that cannot fail that way.
  for (const service of ALL) {
    for (const own of OWN_API) {
      assert.notEqual(FORWARD[service], own);
      assert.ok(
        !FORWARD[service].startsWith(`${own}/`),
        `${service} must not sit under ${own}`,
      );
    }
  }
});

test("and the forwarder has no service that could reach one", () => {
  // The rule stated from the other side: the table is a fixed list, so
  // /api/osm/assess is a 404 rather than a way into the model endpoint.
  for (const own of OWN_API) {
    const name = own.split("/").pop() ?? "";
    assert.equal(SERVICES[name], undefined, `"${name}" must not be a forwarded service`);
  }
  /*
   * The whole list, pinned. Growing it is meant to be a decision somebody made
   * on purpose rather than a line that slipped in — every entry is a host this
   * server will fetch on a visitor's behalf.
   *
   * `vector` is the navigation view's tile source (OpenFreeMap). It is NOT one
   * of the four services the browser resolves through `endpoints.ts`; it is
   * reached only by the style MapLibre loads, which is why it appears here and
   * not in `FORWARD`.
   */
  assert.deepEqual(Object.keys(SERVICES).sort(), ["nominatim", "osrm", "overpass", "tile", "vector"]);
});

test("every forwarded endpoint is same-origin and under /api/osm/", () => {
  for (const service of ALL) {
    const url = FORWARD[service];
    assert.ok(url.startsWith("/api/osm/"), url);
    // A protocol-relative "//evil.example.com" also starts with a slash.
    assert.ok(!url.startsWith("//"), url);
  }
});

test("the tile template keeps the placeholders Leaflet fills in", () => {
  for (const url of [FORWARD.tile, PUBLIC.tile]) {
    for (const token of ["{z}", "{x}", "{y}"]) {
      assert.ok(url.includes(token), `${url} is missing ${token}`);
    }
  }
});

/* --------------------- saying which end actually failed --------------------- */

test("a 502 from our own forwarder is not OpenStreetMap answering 502", () => {
  const message = forwarderFailure("overpass", 502);
  assert.ok(message);
  assert.match(message, /this server could not reach/i);
  assert.match(message, /\/api\/osm\/status/);
});

test("every other status is left to whoever sent it", () => {
  for (const status of [200, 400, 403, 429, 500, 503, 504]) {
    assert.equal(forwarderFailure("overpass", status), null);
  }
});

test("an unanswered request names the end that was actually asked", () => {
  // Forwarded, so the browser was talking to this server, not to OSM.
  assert.match(unreachableMessage("overpass", "OpenStreetMap"), /this server/i);
});

/* ------------- the upstream URL the forwarder then builds from it ----------- */

test("OSRM's coordinates survive the trip — commas and semicolons intact", () => {
  // `encodeURIComponent` turns `4.89,52.37;4.90,52.38` into
  // `4.89%2C52.37%3B4.90%2C52.38`, and OSRM parses that segment itself rather
  // than decoding it first — so it answers 400. Forwarded tiles and search
  // kept working, which made it look like routing was broken.
  const url = upstreamUrl(
    service("osrm"),
    ["route", "v1", "foot", "4.8936,52.3728;4.9003,52.3791"],
    "?overview=full&geometries=geojson&alternatives=3",
  );
  assert.ok(url);
  assert.ok(url.includes("/route/v1/foot/4.8936,52.3728;4.9003,52.3791"), url);
  assert.ok(!url.includes("%2C") && !url.includes("%3B"), url);
});

test("a tile path is passed through unchanged", () => {
  const url = upstreamUrl(service("tile"), ["14", "8399", "5405.png"], "");
  assert.equal(url, "https://tile.openstreetmap.org/14/8399/5405.png");
});

test("leaving the sub-delims alone does not let a host through", () => {
  // A slash inside one segment is still encoded, so it stays one segment.
  const url = upstreamUrl(service("tile"), ["evil.example.com/x"], "");
  assert.ok(url);
  assert.ok(url.startsWith("https://tile.openstreetmap.org/"), url);
  assert.ok(!url.includes("//evil"), url);
});

test("and a climb out of the base is still refused outright", () => {
  assert.equal(upstreamUrl(service("tile"), ["..", "etc"], ""), null);
  assert.equal(upstreamUrl(service("osrm"), ["."], ""), null);
});

test("anything outside a path segment's alphabet is still encoded", () => {
  const url = upstreamUrl(service("nominatim"), ["a b%c"], "");
  assert.equal(url, "https://nominatim.openstreetmap.org/a%20b%25c");
});
