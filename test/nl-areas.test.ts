import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_AREAS,
  normaliseAreaCode,
  parseArea,
  parseAreas,
  parseWktPoint,
  probePoints,
} from "../src/lib/nl-areas.ts";

/* -------------------------------- the codes --------------------------------- */

test("a bare PDOK code is padded to the width StatLine publishes against", () => {
  // `0363` is Amsterdam either way, but only `GM0363` will ever match a row in
  // the crime table. A bare code compares unequal to every row and reads as a
  // neighbourhood the police have no figures for.
  assert.equal(normaliseAreaCode("gemeente", "0363"), "GM0363");
  assert.equal(normaliseAreaCode("gemeente", "363"), "GM0363");
  assert.equal(normaliseAreaCode("wijk", "036300"), "WK036300");
  assert.equal(normaliseAreaCode("buurt", "03630000"), "BU03630000");
});

test("a code that already carries its prefix is not given a second one", () => {
  assert.equal(normaliseAreaCode("buurt", "BU03630000"), "BU03630000");
  assert.equal(normaliseAreaCode("buurt", "bu03630000"), "BU03630000");
  assert.equal(normaliseAreaCode("gemeente", "  GM0363  "), "GM0363");
});

test("anything that is not a code is null, never a defaulted one", () => {
  // A defaulted code would join to the WRONG neighbourhood's figures and be
  // indistinguishable on screen from a correct one.
  assert.equal(normaliseAreaCode("buurt", ""), null);
  assert.equal(normaliseAreaCode("buurt", "   "), null);
  assert.equal(normaliseAreaCode("buurt", "BU-not-a-code"), null);
  assert.equal(normaliseAreaCode("buurt", undefined), null);
  assert.equal(normaliseAreaCode("buurt", 363), null);
});

/* --------------------------------- the point -------------------------------- */

test("WKT is lon-lat, and reading it the other way lands in Somalia", () => {
  // The same trap as OSRM. Read backwards it still returns a coordinate and
  // still draws a marker, which is what makes it hard to see.
  const point = parseWktPoint("POINT(4.893604 52.373055)");
  assert.deepEqual(point, { lat: 52.373055, lng: 4.893604 });
});

test("whitespace and case in the WKT do not break it", () => {
  assert.deepEqual(parseWktPoint("  point( 4.9 52.4 )  "), { lat: 52.4, lng: 4.9 });
  assert.deepEqual(parseWktPoint("POINT(-1.5 -0.25)"), { lat: -0.25, lng: -1.5 });
});

test("an unparseable or out-of-range point is null, not 0,0", () => {
  // 0,0 is a real place in the Gulf of Guinea — the same failure `geocode.ts`
  // refuses, for the same reason.
  assert.equal(parseWktPoint("POINT(4.89)"), null);
  assert.equal(parseWktPoint("POLYGON((0 0))"), null);
  assert.equal(parseWktPoint(""), null);
  assert.equal(parseWktPoint(null), null);
  assert.equal(parseWktPoint("POINT(4.89 91.5)"), null);
  assert.equal(parseWktPoint("POINT(181 52.3)"), null);
});

/* ------------------------------- the documents ------------------------------ */

const AMSTERDAM_DOC = {
  type: "adres",
  weergavenaam: "Dam 1, 1012JS Amsterdam",
  buurtcode: "BU03630000",
  buurtnaam: "Burgwallen-Oude Zijde",
  wijkcode: "WK036300",
  wijknaam: "Burgwallen-Oude Zijde",
  gemeentecode: "0363",
  gemeentenaam: "Amsterdam",
  centroide_ll: "POINT(4.893604 52.373055)",
};

test("the most specific area wins — a neighbourhood, not its municipality", () => {
  const area = parseArea(AMSTERDAM_DOC);
  assert.ok(area);
  assert.equal(area.level, "buurt");
  assert.equal(area.code, "BU03630000");
  assert.equal(area.name, "Burgwallen-Oude Zijde");
  assert.deepEqual(area.point, { lat: 52.373055, lng: 4.893604 });
});

test("a doc with no neighbourhood falls back to the district, then the town", () => {
  const noBuurt = parseArea({ ...AMSTERDAM_DOC, buurtcode: undefined, buurtnaam: undefined });
  assert.equal(noBuurt?.level, "wijk");
  assert.equal(noBuurt?.code, "WK036300");

  const townOnly = parseArea({
    gemeentecode: "0363",
    gemeentenaam: "Amsterdam",
    centroide_ll: "POINT(4.9 52.37)",
  });
  assert.equal(townOnly?.level, "gemeente");
  assert.equal(townOnly?.code, "GM0363");
});

test("a doc with no usable point is dropped rather than placed at 0,0", () => {
  assert.equal(parseArea({ ...AMSTERDAM_DOC, centroide_ll: undefined }), null);
  assert.equal(parseArea({ ...AMSTERDAM_DOC, centroide_ll: "nonsense" }), null);
  assert.equal(parseArea(null), null);
  assert.equal(parseArea("a string"), null);
});

test("a doc with a point but no code at any level is dropped", () => {
  // There is nothing to join it to, so drawing it would be a badge with no
  // figures behind it.
  assert.equal(parseArea({ centroide_ll: "POINT(4.9 52.37)", weergavenaam: "Somewhere" }), null);
});

test("a nameless area falls back to its display name, then to its code", () => {
  const noName = parseArea({ ...AMSTERDAM_DOC, buurtnaam: "  " });
  assert.equal(noName?.name, "Dam 1, 1012JS Amsterdam");

  const nothing = parseArea({
    buurtcode: "BU03630000",
    centroide_ll: "POINT(4.9 52.37)",
  });
  assert.equal(nothing?.name, "BU03630000");
});

/* -------------------------------- the replies ------------------------------- */

test("a reply's docs come back deduplicated by code", () => {
  // Nine probes inside one neighbourhood return the same area nine times; one
  // badge is wanted, not nine stacked on the same pixel.
  const areas = parseAreas({
    response: { docs: [AMSTERDAM_DOC, { ...AMSTERDAM_DOC }, { ...AMSTERDAM_DOC, buurtcode: "BU03630100" }] },
  });
  assert.equal(areas.length, 2);
  assert.deepEqual(areas.map((area) => area.code), ["BU03630000", "BU03630100"]);
});

test("a reply that is not a reply is no areas, not a throw", () => {
  for (const reply of [null, {}, { response: {} }, { response: { docs: "no" } }, 7]) {
    assert.deepEqual(parseAreas(reply), []);
  }
});

/* --------------------------------- the probes ------------------------------- */

test("the probes cover the box and sit INSIDE it, never on its edges", () => {
  // A probe on the boundary picks whichever neighbourhood is a metre the other
  // way, which makes the layer flicker between two answers on a still map.
  const bbox = { south: 52.0, west: 4.0, north: 53.0, east: 5.0 };
  const points = probePoints(bbox, 3);
  assert.equal(points.length, 9);
  for (const point of points) {
    assert.ok(point.lat > bbox.south && point.lat < bbox.north, `lat ${point.lat} on the edge`);
    assert.ok(point.lng > bbox.west && point.lng < bbox.east, `lng ${point.lng} on the edge`);
  }
  // The middle probe is the middle of the box.
  assert.ok(points.some((point) => point.lat === 52.5 && point.lng === 4.5));
});

test("a box with no area produces no probes rather than a pile at one point", () => {
  assert.deepEqual(probePoints({ south: 52, west: 4, north: 52, east: 5 }), []);
  assert.deepEqual(probePoints({ south: 52, west: 4, north: 53, east: 4 }), []);
  // An inverted box is not a box either.
  assert.deepEqual(probePoints({ south: 53, west: 4, north: 52, east: 5 }), []);
});

test("the number of probes is bounded, and so is what they can draw", () => {
  // Every area is a clause in the CBS filter and a badge on the map; both stop
  // being useful long before they stop being possible.
  assert.equal(probePoints({ south: 52, west: 4, north: 53, east: 5 }, 4).length, 16);
  assert.ok(MAX_AREAS > 0 && MAX_AREAS <= 24);
});
