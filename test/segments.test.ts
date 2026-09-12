import test from "node:test";
import assert from "node:assert/strict";

import { pathLengthM } from "../src/lib/geo.ts";
import { readRoute, type SampleRead } from "../src/lib/overpass.ts";
import { assess } from "../src/lib/score.ts";
import {
  describeStretch, describeWorst, NOTABLE_DROP, segmentRoute, WINDOW_M, worstStretch,
} from "../src/lib/segments.ts";

const LAT = 52.37;
const NIGHT = { hour: 23, point: { lat: LAT, lng: 4.89 }, at: new Date("2026-12-21T22:00:00Z") };

/* A straight east–west line, so distance along it is easy to reason about. */
function line(fromLng: number, toLng: number, steps = 40) {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    lat: LAT,
    lng: fromLng + ((toLng - fromLng) * i) / steps,
  }));
}

/** Reads straight down a line, without going through Overpass. */
function reads(count: number, spacingM: number, over: (index: number) => Partial<SampleRead>): SampleRead[] {
  return Array.from({ length: count }, (_, index) => ({
    point: { lat: LAT, lng: 4.88 + index * 0.0004 },
    alongM: index * spacingM,
    lit: "unknown" as const,
    footway: false,
    green: false,
    lamps: 0,
    venues: 0,
    crossings: 0,
    ...over(index),
  }));
}

/* --------------------------------- cutting --------------------------------- */

test("a route is cut into stretches of roughly the window length", () => {
  // 2 km at 25 m per sample.
  const segments = segmentRoute(reads(81, 25, () => ({})), NIGHT);
  assert.ok(segments.length >= 4 && segments.length <= 6, `got ${segments.length} stretches`);
  for (const segment of segments) {
    const span = segment.toM - segment.fromM;
    assert.ok(span >= WINDOW_M * 0.8, `a stretch of ${span} m is too short to score`);
  }
});

test("a route shorter than one window is one stretch, not none", () => {
  // The caller draws whatever it is given; an empty list would leave a short
  // walk silently uncoloured.
  const segments = segmentRoute(reads(8, 25, () => ({})), NIGHT);
  assert.equal(segments.length, 1);
});

test("no reads is no stretches rather than a crash", () => {
  assert.deepEqual(segmentRoute([], NIGHT), []);
});

test("a short tail is folded into the stretch before it, not left on its own", () => {
  // 1.05 km: without folding, the last stretch is 50 m scored off three points
  // — its own block of colour, and quite possibly the "worst" one.
  const segments = segmentRoute(reads(43, 25, () => ({})), NIGHT);
  const last = segments[segments.length - 1];
  assert.ok(last);
  assert.ok(last.toM - last.fromM >= 150, `tail of ${last.toM - last.fromM} m was left standing`);
});

test("consecutive stretches share a point, so the drawn line has no gaps", () => {
  const segments = segmentRoute(reads(81, 25, () => ({})), NIGHT);
  for (let i = 0; i < segments.length - 1; i++) {
    const here = segments[i];
    const next = segments[i + 1];
    assert.ok(here && next);
    const last = here.path[here.path.length - 1];
    const first = next.path[0];
    assert.deepEqual(last, first, "each stretch must end where the next one starts");
  }
});

/* --------------------------------- scoring --------------------------------- */

test("the dark half of a route scores worse than the lit half", () => {
  // 1.6 km: the first 800 m lit and busy, the second 800 m unlit and empty.
  const segments = segmentRoute(
    reads(65, 25, (index) =>
      index < 32
        ? { lit: "yes", lamps: index % 2 === 0 ? 1 : 0, venues: index % 3 === 0 ? 1 : 0 }
        : { lit: "no", green: true },
    ),
    NIGHT,
  );

  const first = segments[0];
  const last = segments[segments.length - 1];
  assert.ok(first?.score !== null && last?.score !== null);
  assert.ok(
    (first?.score ?? 0) > (last?.score ?? 0) + NOTABLE_DROP,
    `lit ${first?.score} should clearly beat unlit ${last?.score}`,
  );
  assert.equal(first?.verdict, "good");
  assert.equal(last?.verdict, "poor");
});

test("a stretch the map says nothing about is unknown, not dark", () => {
  // Every point untagged. Grey on the map, null in the panel — and it must not
  // be scored as though the streets were known to be unlit.
  const segments = segmentRoute(reads(65, 25, () => ({})), NIGHT);
  for (const segment of segments) {
    assert.equal(segment.score, null);
    assert.equal(segment.verdict, "unknown");
  }
});

test("an unknown stretch is never the one singled out", () => {
  // 1.6 km, the middle of it unmapped and the rest lit. The unmapped part has
  // no score, so it cannot be "the worst" — that would turn a gap in the map
  // into an accusation about a street.
  const segments = segmentRoute(
    reads(65, 25, (index) => (index > 20 && index < 44 ? {} : { lit: "yes", lamps: 1 })),
    NIGHT,
  );
  const worst = worstStretch(segments, 70);
  assert.ok(worst === null || worst.score !== null);
});

/* ------------------------------ singling one out ---------------------------- */

test("a route with one genuinely bad stretch names it", () => {
  const segments = segmentRoute(
    reads(65, 25, (index) =>
      index > 40 ? { lit: "no", green: true } : { lit: "yes", lamps: 1, venues: 1 },
    ),
    NIGHT,
  );
  const routeScore = 62;
  const worst = worstStretch(segments, routeScore);
  assert.ok(worst, "the unlit end of the route is worth pointing at");
  assert.ok((worst.score ?? 0) <= routeScore - NOTABLE_DROP);

  const line = describeWorst(worst, routeScore);
  assert.ok(line);
  assert.match(line, new RegExp(`${worst.score}/100`));
  assert.match(line, new RegExp(`against ${routeScore}`), "the route's own score has to be there too");
});

test("a uniform route has no worst stretch, and does not invent one", () => {
  // The same refusal `compare.ts` makes between routes, at a finer grain where
  // the evidence is thinner still.
  const segments = segmentRoute(reads(81, 25, () => ({ lit: "yes", lamps: 1 })), NIGHT);
  const routeScore = assess(
    { lengthM: 2000, samples: 81, litSamples: 81, unlitSamples: 0, unknownLitSamples: 0,
      footwaySamples: 0, greenSamples: 0, lamps: 81, venues: 0, crossings: 0, tunnels: 0 },
    NIGHT,
  ).score;
  assert.equal(worstStretch(segments, routeScore), null);
});

test("one stretch is never singled out — the stretch IS the route", () => {
  const segments = segmentRoute(reads(10, 25, () => ({ lit: "no" })), NIGHT);
  assert.equal(segments.length, 1);
  assert.equal(worstStretch(segments, 40), null);
});

test("an unscoreable route has nothing to point at", () => {
  const segments = segmentRoute(reads(65, 25, () => ({ lit: "no" })), NIGHT);
  assert.equal(worstStretch(segments, null), null);
  assert.equal(describeWorst(segments[0] ?? null, null), null);
});

/* ------------------------------- saying where ------------------------------- */

test("a stretch is placed by street name where the map has one", () => {
  const segments = segmentRoute(
    reads(20, 25, (index) => ({ lit: "no", street: index < 12 ? "Dark Lane" : "Side Street" })),
    NIGHT,
  );
  const first = segments[0];
  assert.ok(first);
  // Commonest first: twelve points against seven.
  assert.deepEqual(first.streets, ["Dark Lane", "Side Street"]);
  assert.match(describeStretch(first), /along Dark Lane and Side Street/);
});

test("an unnamed stretch is placed by distance, not given a made-up label", () => {
  const segments = segmentRoute(reads(65, 25, () => ({ lit: "no" })), NIGHT);
  const second = segments[1];
  assert.ok(second);
  assert.deepEqual(second.streets, []);
  assert.match(describeStretch(second), /starting .* in$/);
});

/* ----------------------- the parts add up to the whole ---------------------- */

test("every count on a route is the sum of the counts on its stretches", () => {
  // The one that matters: lamps and shops are assigned to the nearest point, so
  // a stretch can be counted on its own. Losing or double-counting one there
  // would make the parts quietly disagree with the whole.
  const path = line(4.88, 4.90);
  const elements = [
    { type: "way", id: 1, tags: { highway: "residential", lit: "yes", name: "Lit Street" },
      geometry: line(4.880, 4.890).map((p) => ({ lat: p.lat, lon: p.lng })) },
    { type: "way", id: 2, tags: { highway: "residential", lit: "no", name: "Dark Lane" },
      geometry: line(4.890, 4.900).map((p) => ({ lat: p.lat, lon: p.lng })) },
    ...Array.from({ length: 20 }, (_, i) => ({
      type: "node", id: 100 + i, tags: { highway: "street_lamp" },
      lat: LAT, lon: 4.881 + i * 0.0004,
    })),
    ...Array.from({ length: 9 }, (_, i) => ({
      type: "node", id: 200 + i, tags: { shop: "bakery" },
      lat: LAT, lon: 4.8815 + i * 0.0009,
    })),
  ];

  const { facts, reads: read } = readRoute(path, elements);
  const segments = segmentRoute(read, NIGHT);
  assert.ok(segments.length > 2, `expected several stretches over ${Math.round(pathLengthM(path))} m`);

  const sum = (pick: (s: (typeof segments)[number]) => number) =>
    segments.reduce((total, segment) => total + pick(segment), 0);

  assert.equal(sum((s) => s.facts.samples), facts.samples);
  assert.equal(sum((s) => s.facts.lamps), facts.lamps);
  assert.equal(sum((s) => s.facts.venues), facts.venues);
  assert.equal(sum((s) => s.facts.litSamples), facts.litSamples);
  assert.equal(sum((s) => s.facts.unlitSamples), facts.unlitSamples);
  assert.equal(sum((s) => s.facts.unknownLitSamples), facts.unknownLitSamples);
  assert.ok(facts.lamps > 0 && facts.venues > 0, "the fixture has to actually have some");
});

test("the lit and the unlit halves come back as different stretches", () => {
  const path = line(4.88, 4.90);
  const elements = [
    { type: "way", id: 1, tags: { highway: "residential", lit: "yes", name: "Lit Street" },
      geometry: line(4.880, 4.890).map((p) => ({ lat: p.lat, lon: p.lng })) },
    { type: "way", id: 2, tags: { highway: "residential", lit: "no", name: "Dark Lane" },
      geometry: line(4.890, 4.900).map((p) => ({ lat: p.lat, lon: p.lng })) },
  ];
  const { reads: read } = readRoute(path, elements);
  const segments = segmentRoute(read, NIGHT);

  const first = segments[0];
  const last = segments[segments.length - 1];
  assert.ok(first && last);
  assert.deepEqual(first.streets, ["Lit Street"]);
  assert.deepEqual(last.streets, ["Dark Lane"]);
});

test("the hour re-scores the stretches without re-reading anything", () => {
  const read = reads(65, 25, () => ({ lit: "no", green: true }));
  const night = segmentRoute(read, NIGHT);
  const day = segmentRoute(read, { hour: 12, point: NIGHT.point, at: new Date("2026-12-21T11:00:00Z") });

  assert.equal(night.length, day.length);
  const darkFirst = night[0];
  const dayFirst = day[0];
  assert.ok(darkFirst?.score !== null && dayFirst?.score !== null);
  assert.ok((dayFirst?.score ?? 0) > (darkFirst?.score ?? 0));
});
