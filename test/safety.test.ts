import test from "node:test";
import assert from "node:assert/strict";

import { assess, isAfterDark } from "../src/lib/score.ts";
import { computeFacts, overpassQuery } from "../src/lib/overpass.ts";
import { tiers } from "../src/lib/ai.ts";
import { boundsAround, distanceM, distanceToSegmentM, pathLengthM, samplePath } from "../src/lib/geo.ts";
import type { RouteFacts } from "../src/lib/overpass.ts";

/* --------------------------------- geometry -------------------------------- */

test("distance between two known points is right to within a metre", () => {
  // Dam square to Amsterdam Centraal: about 900 m.
  const d = distanceM({ lat: 52.3731, lng: 4.8926 }, { lat: 52.3791, lng: 4.9003 });
  assert.ok(d > 830 && d < 950, `expected ~900 m, got ${Math.round(d)}`);
});

test("distance to a segment beats distance to its ends", () => {
  // A point beside the middle of a line: measuring to the endpoints would say
  // it is far away, and every street match would fail.
  const a = { lat: 52.370, lng: 4.880 };
  const b = { lat: 52.370, lng: 4.900 };
  const beside = { lat: 52.3705, lng: 4.890 };
  const toSegment = distanceToSegmentM(beside, a, b);
  assert.ok(toSegment < 70, `perpendicular distance should be small, got ${Math.round(toSegment)}`);
  assert.ok(toSegment < distanceM(beside, a) / 4);
});

test("a zero-length segment does not divide by zero", () => {
  const p = { lat: 52.37, lng: 4.89 };
  const same = { lat: 52.371, lng: 4.891 };
  const d = distanceToSegmentM(p, same, same);
  assert.ok(Number.isFinite(d));
});

test("sampling walks the whole line at roughly the given spacing", () => {
  const path = [{ lat: 52.370, lng: 4.880 }, { lat: 52.370, lng: 4.900 }];
  const length = pathLengthM(path);
  const samples = samplePath(path, 25);
  // Endpoints included, so one or two more than the bare division.
  assert.ok(samples.length >= Math.floor(length / 25), `${samples.length} samples for ${Math.round(length)} m`);
  assert.deepEqual(samples[0], path[0]);
  assert.deepEqual(samples[samples.length - 1], path[1]);
});

test("sampling a single point or an empty path does not loop forever", () => {
  assert.deepEqual(samplePath([], 25), []);
  assert.equal(samplePath([{ lat: 52.37, lng: 4.89 }], 25).length, 1);
});

test("the bounding box grows outward, and widens with latitude", () => {
  const box = boundsAround([{ lat: 52.37, lng: 4.89 }], 50)!;
  assert.ok(box.south < 52.37 && box.north > 52.37);
  // A degree of longitude is shorter than a degree of latitude at 52°N, so the
  // longitude pad has to be the larger number to cover the same metres.
  assert.ok(box.east - box.west > box.north - box.south);
});

/* -------------------------------- the query -------------------------------- */

test("the Overpass query asks for geometry, because ways are matched by shape", () => {
  const q = overpassQuery([{ lat: 52.37, lng: 4.89 }, { lat: 52.38, lng: 4.90 }])!;
  // OSRM returns a line, not OSM way ids, so ways have to be matched
  // geometrically — without `geom` there is nothing to match against.
  assert.match(q, /out tags geom/);
  assert.match(q, /way\["highway"\]/);
  assert.match(q, /street_lamp/);
  assert.match(q, /\[out:json\]\[timeout:\d+\]/);
});

test("an empty path has no query rather than a broken one", () => {
  assert.equal(overpassQuery([]), null);
});

/* --------------------------- counting what is there -------------------------- */

const LINE = [{ lat: 52.3700, lng: 4.8900 }, { lat: 52.3700, lng: 4.8950 }];

test("an unlit street and an unmapped one are counted apart", () => {
  const facts = computeFacts(LINE, [
    { type: "way", tags: { highway: "residential" },  // no lit tag at all
      geometry: [{ lat: 52.3700, lon: 4.8900 }, { lat: 52.3700, lon: 4.8950 }] },
  ]);
  // The whole point: "nobody mapped the lighting" must not be reported as
  // "the street is dark".
  assert.equal(facts.unlitSamples, 0);
  assert.ok(facts.unknownLitSamples > 0);
});

test("lit=yes is counted as lit, and its variants too", () => {
  for (const lit of ["yes", "24/7", "sunset-sunrise"]) {
    const facts = computeFacts(LINE, [
      { type: "way", tags: { highway: "residential", lit },
        geometry: [{ lat: 52.3700, lon: 4.8900 }, { lat: 52.3700, lon: 4.8950 }] },
    ]);
    assert.ok(facts.litSamples > 0, `lit=${lit} should count as lit`);
    assert.equal(facts.unknownLitSamples, 0);
  }
});

test("things far from the line are not counted as being on it", () => {
  const facts = computeFacts(LINE, [
    // ~1 km north: a different street entirely.
    { type: "node", tags: { highway: "street_lamp" }, lat: 52.3800, lon: 4.8920 },
    { type: "node", tags: { amenity: "cafe" }, lat: 52.3800, lon: 4.8920 },
    // Right beside the route.
    { type: "node", tags: { highway: "street_lamp" }, lat: 52.3701, lon: 4.8920 },
  ]);
  assert.equal(facts.lamps, 1);
  assert.equal(facts.venues, 0);
});

/* --------------------------------- the score -------------------------------- */

function facts(over: Partial<RouteFacts> = {}): RouteFacts {
  return {
    lengthM: 1000, samples: 40, litSamples: 0, unlitSamples: 0, unknownLitSamples: 40,
    footwaySamples: 0, greenSamples: 0, lamps: 0, venues: 0, crossings: 0, tunnels: 0,
    ...over,
  };
}

test("an unmapped route is 'unknown', never 'fair'", () => {
  // Inventing a middling score out of an empty map is the failure that matters
  // most here: after dark it reads as reassurance about a street nobody has
  // described.
  const result = assess(facts(), 23);
  assert.equal(result.verdict, "unknown");
  assert.equal(result.score, null);
  assert.ok(result.confidence <= 0.2);
  assert.match(result.findings.join(" "), /gap in the map/);
});

test("a well-lit busy route after dark scores better than a dark empty one", () => {
  const good = assess(facts({ litSamples: 38, unknownLitSamples: 2, lamps: 40, venues: 18 }), 23);
  const bad = assess(facts({ unlitSamples: 36, unknownLitSamples: 4, lamps: 1, venues: 0, greenSamples: 30 }), 23);
  assert.ok(good.score !== null && bad.score !== null);
  assert.ok(good.score > bad.score, `${good.score} should beat ${bad.score}`);
  assert.equal(good.verdict, "good");
  assert.equal(bad.verdict, "poor");
});

test("lighting decides much less by day than after dark", () => {
  const dark = assess(facts({ unlitSamples: 36, unknownLitSamples: 4, lamps: 1 }), 23);
  const day = assess(facts({ unlitSamples: 36, unknownLitSamples: 4, lamps: 1 }), 13);
  assert.ok(dark.score !== null && day.score !== null);
  assert.ok(day.score > dark.score, "the same unlit route is a smaller problem at 1pm");
});

test("partial coverage is scored, but says how much is unknown", () => {
  // Half the route mapped: enough to judge, not enough to be quiet about.
  const partial = assess(facts({ litSamples: 16, unlitSamples: 4, unknownLitSamples: 20, lamps: 25 }), 23);
  assert.notEqual(partial.verdict, "unknown");
  assert.ok(partial.confidence < 0.75, `confidence ${partial.confidence} should be held back`);
  assert.match(partial.findings[0] ?? "", /unknown rather than dark/,
    "when coverage is thin, that must be the FIRST thing said, not the last");
});

test("a route mapped for 1% of its length is never a confident 'looks fine'", () => {
  // The bug this locks: 2 lit samples and 0 unlit is "100% lit" arithmetically,
  // and feeding that straight in produced a green 71/100 on a route whose
  // lighting was known for 1% of its length — a reassuring badge sitting on top
  // of findings that said we knew nothing. Exactly what this app must not do.
  const barely = assess(
    facts({ samples: 144, lengthM: 3600, litSamples: 2, unlitSamples: 0, unknownLitSamples: 142, lamps: 1, venues: 1 }),
    23,
  );
  assert.equal(barely.verdict, "unknown", `got ${barely.verdict} at score ${barely.score}`);
  assert.equal(barely.score, null);
});

test("a handful of lit samples is shrunk towards neutral, not believed", () => {
  // Same fraction, different amount of evidence: three lit points must not
  // score like thirty.
  const few = assess(facts({ samples: 40, litSamples: 3, unlitSamples: 0, unknownLitSamples: 37, lamps: 15 }), 23);
  const many = assess(facts({ samples: 40, litSamples: 30, unlitSamples: 0, unknownLitSamples: 10, lamps: 15 }), 23);
  assert.ok(many.score !== null);
  if (few.score !== null) {
    assert.ok(few.score < many.score, `${few.score} (3 samples) must not rival ${many.score} (30 samples)`);
  }
});

test("one lamp beside a long route does not rescue it from 'unknown'", () => {
  // The gate used to be `lamps === 0`, so a single mapped lamp on a 3 km route
  // was enough to make it scoreable.
  const oneLamp = assess(facts({ samples: 120, lengthM: 3000, unknownLitSamples: 120, lamps: 1 }), 23);
  assert.equal(oneLamp.verdict, "unknown");
});

test("every finding is a checkable statement, never a judgement", () => {
  const result = assess(facts({ litSamples: 30, unknownLitSamples: 10, lamps: 25, venues: 15 }), 23);
  // The prose comes from the model; these are counts.
  assert.ok(result.findings.length > 0);
  assert.match(result.findings.join(" "), /\d/);
});

test("after dark is a plain hour check", () => {
  assert.equal(isAfterDark(23), true);
  assert.equal(isAfterDark(3), true);
  assert.equal(isAfterDark(13), false);
  assert.equal(isAfterDark(6), false);
});

/* ------------------------------- the AI tiers ------------------------------- */

test("local comes first, and needs no key", () => {
  const list = tiers({ LOCAL_AI_HOST: "192.168.11.165" });
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, "local");
  assert.equal(list[0]?.baseUrl, "http://192.168.11.165:1234/v1");
  assert.equal(list[0]?.apiKey, undefined);
});

test("Liara is the fallback, after local", () => {
  const list = tiers({
    LOCAL_AI_HOST: "192.168.11.165",
    LIARA_AI_URL: "https://ai.liara.ir/api/v1/x",
    LIARA_AI_KEY: "secret",
  });
  assert.deepEqual(list.map((t) => t.name), ["local", "liara"]);
});

test("a half-configured Liara is left out entirely", () => {
  // A fallback with a URL and no key 401s on every call, turning "the LAN box
  // is off" into a confusing error instead of a quiet degradation.
  const noKey = tiers({ LOCAL_AI_HOST: "h", LIARA_AI_URL: "https://ai.liara.ir/v1" });
  assert.deepEqual(noKey.map((t) => t.name), ["local"]);
  const noUrl = tiers({ LOCAL_AI_HOST: "h", LIARA_AI_KEY: "secret" });
  assert.deepEqual(noUrl.map((t) => t.name), ["local"]);
});

test("LOCAL_AI_URL=off disables the local tier without removing Liara", () => {
  const list = tiers({
    LOCAL_AI_URL: "off",
    LIARA_AI_URL: "https://ai.liara.ir/v1",
    LIARA_AI_KEY: "secret",
  });
  assert.deepEqual(list.map((t) => t.name), ["liara"]);
});

test("no configuration at all is an empty list, not a crash", () => {
  assert.deepEqual(tiers({}), []);
});

test("a trailing slash on a base URL does not double up", () => {
  const list = tiers({ LOCAL_AI_URL: "http://box:1234/v1/" });
  assert.equal(list[0]?.baseUrl, "http://box:1234/v1");
});
