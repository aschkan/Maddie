import test from "node:test";
import assert from "node:assert/strict";

import { hasResults, PC_PORTS, PC_RELAY, pcTarget, tileCorners } from "../src/lib/osm-forward.ts";

/*
 * The study PC holds the NETHERLANDS only. Every rule here is the same one the
 * local Overpass keeps: asked only about what it holds, because a one-country
 * server asked about anywhere else answers with a blank tile, no route or no
 * result — a wrong answer that looks like a right one.
 */

/** Slippy tile containing a point. */
function tileAt(lat: number, lng: number, z: number): [number, number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [z, x, y];
}

test("a tile wholly inside the Netherlands goes to the PC; Brussels, Germany and low zooms do not", () => {
  const [z, x, y] = tileAt(52.09, 5.12, 15); // Utrecht
  assert.deepEqual(pcTarget("tile", [String(z), String(x), `${y}.png`], ""), {
    url: `${PC_RELAY}:${PC_PORTS.tile}/styles/maddie/${z}/${x}/${y}.png`, timeoutMs: 8_000,
  });
  const brussels = tileAt(50.85, 4.35, 15);
  assert.equal(pcTarget("tile", [String(brussels[0]), String(brussels[1]), `${brussels[2]}.png`], ""), null);
  const cologne = tileAt(50.94, 6.96, 15);
  assert.equal(pcTarget("tile", [String(cologne[0]), String(cologne[1]), `${cologne[2]}.png`], ""), null);
  const wide = tileAt(52.09, 5.12, 5);
  assert.equal(pcTarget("tile", [String(wide[0]), String(wide[1]), `${wide[2]}.png`], ""), null);
  assert.equal(pcTarget("tile", ["15", "..", "1.png"], ""), null);
});

test("tile corners come back as [lat, lng], north-west first", () => {
  const [[lat, lng]] = tileCorners(1, 0, 0) as [[number, number]];
  assert.ok(Math.abs(lat - 85.0511) < 0.001 && lng === -180);
});

test("a route is sent to the PC profile it names, only when every point is inside", () => {
  const inside = "5.11,52.09;5.17,52.08";
  assert.equal(pcTarget("osrm", ["route", "v1", "foot", inside], "?overview=full")?.url,
    `${PC_RELAY}:${PC_PORTS.foot}/route/v1/foot/${inside}?overview=full`);
  assert.equal(pcTarget("osrm", ["route", "v1", "bike", inside], "")?.url.includes(`:${PC_PORTS.bike}/`), true);
  assert.equal(pcTarget("osrm", ["route", "v1", "driving", inside], "")?.url.includes(`:${PC_PORTS.driving}/`), true);
  // Utrecht to Brussels: one point outside → the public router.
  assert.equal(pcTarget("osrm", ["route", "v1", "foot", "5.11,52.09;4.35,50.85"], ""), null);
  // lon,lat read the wrong way round would put Utrecht off Somalia; it must not slip in.
  assert.equal(pcTarget("osrm", ["route", "v1", "foot", "52.09,5.11;52.08,5.17"], ""), null);
  assert.equal(pcTarget("osrm", ["route", "v1", "train", inside], ""), null);
  assert.equal(pcTarget("osrm", ["table", "v1", "foot", inside], ""), null);
});

test("a search goes to the PC but only counts when it found something; reverse needs a Dutch point", () => {
  const search = pcTarget("nominatim", ["search"], "?q=Utrecht+Centraal&format=jsonv2");
  assert.equal(search?.needsResults, true);
  assert.equal(search?.url, `${PC_RELAY}:${PC_PORTS.nominatim}/search?q=Utrecht+Centraal&format=jsonv2`);
  assert.ok(pcTarget("nominatim", ["reverse"], "?lat=52.09&lon=5.12&format=jsonv2"));
  assert.equal(pcTarget("nominatim", ["reverse"], "?lat=50.85&lon=4.35"), null);
  assert.equal(pcTarget("nominatim", ["status"], ""), null);
  assert.equal(hasResults("[]"), false);
  assert.equal(hasResults('[{"lat":"52"}]'), true);
  assert.equal(hasResults('{"error":"Unable to geocode"}'), false);
  assert.equal(hasResults("<html>"), false);
});

test("Overpass, the police figures and anything else never go to the PC", () => {
  for (const name of ["overpass", "cbs", "pdok", "pdokwfs", "vector"]) assert.equal(pcTarget(name, ["x"], ""), null, name);
});
