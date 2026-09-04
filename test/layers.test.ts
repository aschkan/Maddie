import test from "node:test";
import assert from "node:assert/strict";

import {
  alwaysOpen, classify, layerQuery, parseLayers, SAFE_SPOTS, spotKind,
} from "../src/lib/layers.ts";

const BOX = { south: 52.36, west: 4.87, north: 52.38, east: 4.91 };

/* ---------------------------------- query ---------------------------------- */

test("no layers selected asks Overpass nothing at all", () => {
  // A query for an empty union is a syntax error, and sending one costs a
  // request slot to be told so.
  assert.equal(layerQuery(BOX, [], false), null);
});

test("each selected kind is asked for as both a node and a way", () => {
  // A bus stop is a point and a hospital is a building; asking for only one
  // shape silently loses half the answers.
  const query = layerQuery(BOX, ["police"], false) ?? "";
  assert.match(query, /node\["amenity"="police"\]/);
  assert.match(query, /way\["amenity"="police"\]/);
});

test("an unknown kind is ignored rather than pasted into the query", () => {
  // The ids come from component state, and Overpass QL has no escaping — a
  // stale or hand-edited id must not reach the server as a filter.
  assert.equal(layerQuery(BOX, ["'; out; //"], false), null);
});

test("lighting asks for lamps and for lit streets, with geometry only on the streets", () => {
  const query = layerQuery(BOX, [], true) ?? "";
  assert.match(query, /node\["highway"="street_lamp"\]/);
  assert.match(query, /way\["highway"\]\["lit"="yes"\]/);
  // The lamps are points; asking for their geometry is payload for nothing.
  assert.match(query, /\.lamps out \d+;/);
  assert.match(query, /\.lit out tags geom \d+;/);
});

test("spots come back as centres, not as full building outlines", () => {
  const query = layerQuery(BOX, ["hospital"], false) ?? "";
  assert.match(query, /\.spots out tags center \d+;/);
  assert.doesNotMatch(query, /\.spots out tags geom/);
});

test("every kind's filter parses back out of its own match string", () => {
  // `classify` reads these strings with a regex. A kind whose filter it cannot
  // parse would be queried for and then never recognised in the reply —
  // markers silently missing for one category only.
  for (const kind of SAFE_SPOTS) {
    const pairs = [...kind.match.matchAll(/\["([^"]+)"(=|~)"([^"]+)"\]/g)];
    assert.ok(pairs.length > 0, `${kind.id}: filter did not parse`);
  }
});

/* --------------------------------- parsing --------------------------------- */

test("a node and a building both become one marker", () => {
  const data = parseLayers({
    elements: [
      { type: "node", id: 1, lat: 52.37, lon: 4.89, tags: { amenity: "police", name: "Bureau" } },
      { type: "way", id: 2, center: { lat: 52.371, lon: 4.891 }, tags: { amenity: "hospital" } },
    ],
  });
  assert.equal(data.spots.length, 2);
  assert.equal(data.spots[0]?.name, "Bureau");
  assert.equal(data.spots[1]?.kind, "hospital");
  // `center` is where a way's marker goes; without it the way has no point.
  assert.deepEqual(data.spots[1]?.point, { lat: 52.371, lng: 4.891 });
});

test("a lit street becomes a line, not a marker", () => {
  const data = parseLayers({
    elements: [{
      type: "way", id: 3,
      tags: { highway: "residential", lit: "yes", name: "Prinsengracht" },
      geometry: [{ lat: 52.37, lon: 4.88 }, { lat: 52.372, lon: 4.882 }],
    }],
  });
  assert.equal(data.litWays.length, 1);
  assert.equal(data.spots.length, 0);
  assert.equal(data.litWays[0]?.path.length, 2);
  assert.deepEqual(data.litWays[0]?.path[0], { lat: 52.37, lng: 4.88 });
});

test("a lit street of one point is dropped — a line needs two", () => {
  const data = parseLayers({
    elements: [{ type: "way", id: 4, tags: { lit: "yes" }, geometry: [{ lat: 52.37, lon: 4.88 }] }],
  });
  assert.equal(data.litWays.length, 0);
});

test("street lamps are their own thing, not an unrecognised spot", () => {
  const data = parseLayers({
    elements: [{ type: "node", id: 5, lat: 52.37, lon: 4.89, tags: { highway: "street_lamp" } }],
  });
  assert.equal(data.lamps.length, 1);
  assert.equal(data.spots.length, 0);
});

test("an element with no usable coordinates is dropped, not placed at 0,0", () => {
  // 0,0 is a real place in the Gulf of Guinea. A marker there is a silent
  // wrong answer where a missing marker would have been an obvious one.
  const data = parseLayers({
    elements: [
      { type: "node", id: 6, tags: { amenity: "police" } },
      { type: "node", id: 7, lat: Number.NaN, lon: 4.89, tags: { amenity: "police" } },
      { type: "node", id: 8, lat: "52.37" as unknown as number, lon: 4.89, tags: { amenity: "police" } },
    ],
  });
  assert.equal(data.spots.length, 0);
});

test("the same element twice draws one marker", () => {
  // Overlapping filters — a 24/7 gym is also a fitness centre — return the
  // same element more than once in one reply.
  const element = { type: "node", id: 9, lat: 52.37, lon: 4.89, tags: { amenity: "police" } };
  const data = parseLayers({ elements: [element, element] });
  assert.equal(data.spots.length, 1);
});

test("nonsense in place of a reply is an empty map, not a crash", () => {
  for (const bad of [null, undefined, 42, "elements", [], {}, { elements: "no" }]) {
    const data = parseLayers(bad);
    assert.deepEqual(data.spots, []);
    assert.deepEqual(data.lamps, []);
    assert.deepEqual(data.litWays, []);
  }
});

/* ------------------------------- classifying ------------------------------- */

test("a kind with two tags needs both of them", () => {
  // A gym is only listed if it is tagged 24/7. A gym that closes at ten is
  // exactly the wrong thing to send someone towards at two in the morning.
  assert.equal(classify({ leisure: "fitness_centre" }), null);
  assert.equal(classify({ leisure: "fitness_centre", opening_hours: "24/7" })?.id, "gym24");
  assert.equal(classify({ leisure: "fitness_centre", opening_hours: "Mo-Fr 06:00-23:00" }), null);
});

test("a regex filter matches its alternatives and nothing else", () => {
  assert.equal(classify({ amenity: "cafe" })?.id, "bar");
  assert.equal(classify({ amenity: "pub" })?.id, "bar");
  assert.equal(classify({ amenity: "cinema" }), null);
});

test("spotKind finds a kind by id, and does not invent one", () => {
  assert.equal(spotKind("police")?.label, "Police station");
  assert.equal(spotKind("nope"), undefined);
});

/* ------------------------------ opening hours ------------------------------ */

test("only 24/7 is read; everything else is shown as written", () => {
  // Half-parsing `opening_hours` gives a confident "open now" for a shop that
  // shut at six, and someone walks to a locked door at 2 a.m. because of it.
  assert.equal(alwaysOpen("24/7"), true);
  assert.equal(alwaysOpen(" 24/7 "), true);
  assert.equal(alwaysOpen("Mo-Su 00:00-24:00"), false);
  assert.equal(alwaysOpen("Mo-Fr 09:00-18:00"), false);
  assert.equal(alwaysOpen(undefined), false);
});
