import test from "node:test";
import assert from "node:assert/strict";

import { ALL_FACTORS, allOn, assess, FACTORS, type Factors } from "../src/lib/score.ts";
import { segmentRoute } from "../src/lib/segments.ts";
import type { RouteFacts, SampleRead } from "../src/lib/overpass.ts";

/*
 * The Layers tab's "what counts". One formula, terms switched off — never a
 * second set of weights. Every route scored with everything on must be scored
 * exactly as it always was.
 */

const NIGHT = 23;

function facts(overrides: Partial<RouteFacts> = {}): RouteFacts {
  return {
    lengthM: 2000, samples: 80, litSamples: 40, unlitSamples: 20, unknownLitSamples: 20,
    footwaySamples: 10, greenSamples: 30, lamps: 6, venues: 3, crossings: 4, tunnels: 1,
    ...overrides,
  };
}

const without = (...off: (keyof Factors)[]): Factors => {
  const out = { ...ALL_FACTORS };
  for (const id of off) out[id] = false;
  return out;
};

test("with every factor on, the reading is exactly the reading without the argument", () => {
  for (const hour of [3, 12, 19, 23]) {
    assert.deepEqual(assess(facts(), hour, ALL_FACTORS), assess(facts(), hour));
  }
  assert.equal(allOn(ALL_FACTORS), true);
  assert.equal(allOn(without("tunnels")), false);
});

test("switching lighting off makes the lit counts irrelevant", () => {
  const dark = facts({ litSamples: 2, unlitSamples: 70, unknownLitSamples: 8 });
  const bright = facts({ litSamples: 70, unlitSamples: 2, unknownLitSamples: 8 });
  assert.notEqual(assess(dark, NIGHT).score, assess(bright, NIGHT).score);
  assert.equal(assess(dark, NIGHT, without("lighting")).score, assess(bright, NIGHT, without("lighting")).score);
});

test("with lighting off, thin lighting coverage no longer withholds a reading", () => {
  // The coverage gate is a question about LIGHTING data. A person who said
  // lighting does not count for them should still get a reading from the rest.
  const unmapped = facts({ litSamples: 1, unlitSamples: 1, unknownLitSamples: 78, lamps: 0 });
  assert.equal(assess(unmapped, NIGHT).score, null);
  assert.notEqual(assess(unmapped, NIGHT, without("lighting")).score, null);
});

test("each factor, switched off, removes only its own term", () => {
  const base = facts();
  const parkless = assess(base, NIGHT, without("parkland"));
  assert.ok(!parkless.findings.some((line) => /parkland/i.test(line)), "a switched-off factor is not reported");
  assert.ok((parkless.score ?? 0) > (assess(base, NIGHT).score ?? 0), "the parkland penalty is gone");

  const tunnelless = assess(base, NIGHT, without("tunnels"));
  assert.ok((tunnelless.score ?? 0) > (assess(base, NIGHT).score ?? 0), "the tunnel penalty is gone");
});

test("everything switched off is no reading at all, never the formula's starting 55", () => {
  const none = Object.fromEntries(FACTORS.map((factor) => [factor.id, false])) as unknown as Factors;
  const result = assess(facts(), NIGHT, none);
  assert.equal(result.score, null);
  assert.equal(result.verdict, "unknown");
  assert.ok(result.findings.some((line) => /switched off/i.test(line)));
});

test("the stretches of a route are read with the route's own switches", () => {
  // A stretch judged with a factor the whole route ignores would contradict
  // the route it is in.
  const reads: SampleRead[] = Array.from({ length: 64 }, (_, index) => ({
    point: { lat: 52.09 + index * 0.0002, lng: 5.11 },
    alongM: index * 25,
    lit: index < 32 ? "no" : "yes",
    footway: false, green: false, lamps: 0, venues: 0, crossings: 0,
  }));
  const on = segmentRoute(reads, NIGHT);
  const off = segmentRoute(reads, NIGHT, without("lighting"));
  assert.ok(new Set(on.map((segment) => segment.score)).size > 1, "lighting splits the stretches when it counts");
  assert.equal(new Set(off.map((segment) => segment.score)).size, 1, "and does not when it is switched off");
});
