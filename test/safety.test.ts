import test from "node:test";
import assert from "node:assert/strict";

import { assess } from "../src/lib/score.ts";
import { computeFacts, overpassQuery } from "../src/lib/overpass.ts";
import { AI_API_KEY, AI_BASE_URL, AI_MODEL, narrate, prompt } from "../src/lib/ai.ts";
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
  // Lamps and crossings share one clause — each clause repeats every coordinate.
  assert.equal((q.match(/around:/g) ?? []).length, 7);
  assert.match(q, /\[out:json\]\[timeout:\d+\]/);
});

test("the query is a corridor along the route, not a box around it", () => {
  // The bug this locks: a bbox around a 7.4 km route across Amsterdam covers
  // 7.5 km², fifteen times the area the route occupies, and asking for every
  // road and shop inside it is expensive enough that Overpass answers 504
  // whenever it is busy — an intermittent failure that reads like a bad
  // connection and is actually a query that is too big.
  const long: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    long.push({ lat: 52.37172 + (52.38629 - 52.37172) * t, lng: 4.89080 + (4.82780 - 4.89080) * t });
  }
  const q = overpassQuery(long)!;
  assert.match(q, /around:\d+,/, "must search along the line");
  // A bare four-number bbox clause would mean the rectangle came back.
  const withoutCorridors = q.replace(/around:\d+,[-\d.,]+/g, "CORRIDOR");
  assert.doesNotMatch(withoutCorridors, /\(\s*-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+\s*\)/);
});

test("a very long route does not produce an unbounded query", () => {
  // 200 km. The spine is capped, so the query stays a sane size instead of
  // growing until Overpass refuses to parse it.
  const huge: { lat: number; lng: number }[] = [];
  for (let i = 0; i <= 400; i++) huge.push({ lat: 52 + i * 0.005, lng: 4.9 });
  const q = overpassQuery(huge)!;
  // The coordinate list is repeated per clause, so this grows as points ×
  // clauses. 250 points across eight clauses made a 34 KB query that Overpass
  // has to parse before it can refuse it.
  assert.ok(q.length < 20_000, `query is ${q.length} bytes`);
});

test("a route of one point has no query rather than a broken one", () => {
  assert.equal(overpassQuery([{ lat: 52.37, lng: 4.89 }]), null);
  assert.equal(overpassQuery([]), null);
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

test("an hour with no place to stand falls back to the clock, and says so", () => {
  // `sunDeg: null` is the marker: the light state was guessed from the hour,
  // not worked out from the sky. Reporting a guess as a sunset is the failure
  // this field exists to make impossible.
  const guessed = assess(facts({ litSamples: 30, unknownLitSamples: 10, lamps: 25 }), 23);
  assert.equal(guessed.light, "night");
  assert.equal(guessed.sunDeg, null);
  assert.equal(assess(facts(), 13).light, "day");
});

/* -------------------------------- the model -------------------------------- */

test("the model is configured in the source, with nothing to set", () => {
  // Hardcoded on purpose — see the header of ai.ts. What is pinned here is that
  // it stays a complete, usable configuration rather than half of one: a base
  // URL with no key 401s on every call, which reads as "the model is down".
  assert.match(AI_BASE_URL, /^https:\/\/ai\.liara\.ir\/api\/[a-z0-9]+\/v1$/);
  assert.ok(!AI_BASE_URL.endsWith("/v1/"), "a trailing slash would double up the path");
  assert.ok(AI_API_KEY.length > 40, "the key is not a placeholder");
});

test("the model is a CHAT model, not an embedding one", () => {
  // Liara's own sample snippet calls text-embedding-3-large. An embedding model
  // returns vectors and refuses /chat/completions, so wiring it here would lose
  // the sentence on every single request while looking configured.
  assert.doesNotMatch(AI_MODEL, /embedding/);
});

test("the prompt carries the counts and never asks for a score", () => {
  const assessment = assess(facts({ litSamples: 30, unknownLitSamples: 10 }), 22);
  const text = prompt(facts({ litSamples: 30, unknownLitSamples: 10 }), assessment);
  assert.match(text, /30 points on streets mapped lit/);
  assert.match(text, /10 with no lighting information/);
  // The score is shown separately and the model is told not to state one; it is
  // never handed the number, so it cannot repeat it back slightly wrong.
  assert.doesNotMatch(text, new RegExp(`\\b${assessment.score}\\b`));
});

test("a model that cannot be reached costs the sentence and nothing else", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () => { throw new Error("getaddrinfo ENOTFOUND ai.liara.ir"); }) as typeof fetch;

  const result = await narrate(facts(), assess(facts(), 22), { timeoutMs: 50 });
  assert.equal(result.text, null);
  assert.equal(result.source, null);
  assert.match(result.note ?? "", /ENOTFOUND/);
});

test("an empty reply is a failure, not an empty sentence", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "   " } }] }), {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const result = await narrate(facts(), assess(facts(), 22));
  assert.equal(result.text, null);
  assert.equal(result.source, null);
});

test("an answer is attributed, so the panel can say where it came from", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "Most of this walk is mapped lit." } }] }), {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const result = await narrate(facts(), assess(facts(), 22));
  assert.equal(result.text, "Most of this walk is mapped lit.");
  assert.equal(result.source, "liara");
});
