import test from "node:test";
import assert from "node:assert/strict";

import { SERVICES } from "../src/lib/osm-forward.ts";

/*
 * Every Overpass mirror in the rotation must hold the WHOLE planet.
 *
 * A regional instance answers a query outside its region with a 200 and an
 * empty list — indistinguishable, to the code reading it, from a place nobody
 * has mapped. `overpass.osm.ch` (Switzerland only) sat in this list and did
 * exactly that to Dutch queries, silently, cached for ten minutes at a time.
 */

/**
 * Hosts CONFIRMED to serve a regional extract — checked by querying them for a
 * Dutch bounding box, not assumed from the domain. Add to this, never remove.
 */
const REGIONAL = [/osm\.ch\b/];

test("no regional Overpass instance is in the rotation", () => {
  const overpass = SERVICES.overpass;
  assert.ok(overpass);
  for (const base of overpass.bases) {
    for (const pattern of REGIONAL) {
      assert.doesNotMatch(base, pattern, `${base} serves a regional extract — its empty answers read as unmapped streets`);
    }
  }
});

/* ── our own Overpass: asked only about what it holds ─────────────────────── */

import { NETHERLANDS, queryWithin } from "../src/lib/osm-forward.ts";
import { overpassQuery } from "../src/lib/overpass.ts";
import { layerQuery } from "../src/lib/layers.ts";

const form = (query: string) => `data=${encodeURIComponent(query)}`;

test("a route read and a layer query in Utrecht go to the local Overpass", () => {
  const route = overpassQuery([{ lat: 52.0894, lng: 5.1096 }, { lat: 52.1101, lng: 5.1258 }]);
  const layers = layerQuery({ south: 52.08, west: 5.10, north: 52.10, east: 5.13 }, ["police"], true);
  assert.ok(route && layers);
  assert.equal(queryWithin(form(route), NETHERLANDS), true);
  assert.equal(queryWithin(form(layers), NETHERLANDS), true);
});

test("anywhere outside the Netherlands never reaches it — an empty answer there would be false", () => {
  // Brussels, and a route that crosses the border into Belgium.
  const brussels = layerQuery({ south: 50.84, west: 4.34, north: 50.86, east: 4.37 }, ["police"], true);
  const crossing = overpassQuery([{ lat: 51.44, lng: 5.48 }, { lat: 50.88, lng: 4.70 }]);
  const london = overpassQuery([{ lat: 51.50, lng: -0.12 }, { lat: 51.52, lng: -0.10 }]);
  assert.ok(brussels && crossing && london);
  assert.equal(queryWithin(form(brussels), NETHERLANDS), false);
  assert.equal(queryWithin(form(crossing), NETHERLANDS), false);
  assert.equal(queryWithin(form(london), NETHERLANDS), false);
});

test("a query with no coordinates is not 'within' anything", () => {
  assert.equal(queryWithin(form("[out:json][timeout:25];node(1);out;"), NETHERLANDS), false);
  assert.equal(queryWithin("", NETHERLANDS), false);
});

test("the coverage is the country's shape, not a box that holds Flanders too", () => {
  // Brussels, Antwerp, Leuven, Aachen, Emmerich, Lille: all inside a naive box.
  const abroad: [number, number][] = [[50.85, 4.35], [51.22, 4.40], [50.88, 4.70], [50.78, 6.08], [51.83, 6.25], [50.63, 3.06]];
  for (const [lat, lng] of abroad) {
    const query = `[out:json];node(${lat.toFixed(5)},${lng.toFixed(5)},${(lat + 0.01).toFixed(5)},${(lng + 0.01).toFixed(5)});out;`;
    assert.equal(queryWithin(form(query), NETHERLANDS), false, `${lat},${lng} is not in the Netherlands`);
  }
  // Utrecht, Amsterdam, Rotterdam, Groningen, Zwolle: inside.
  const home: [number, number][] = [[52.09, 5.12], [52.37, 4.89], [51.92, 4.48], [53.22, 6.57], [52.51, 6.09]];
  for (const [lat, lng] of home) {
    const query = `[out:json];node(${lat.toFixed(5)},${lng.toFixed(5)},${(lat + 0.01).toFixed(5)},${(lng + 0.01).toFixed(5)});out;`;
    assert.equal(queryWithin(form(query), NETHERLANDS), true, `${lat},${lng} is in the Netherlands`);
  }
});
