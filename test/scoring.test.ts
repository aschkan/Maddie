import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areaCrimeScore,
  pointCrimeScore,
  BASIS_CONFIDENCE,
  incidentHistory,
  lighting,
  DIMENSION_WEIGHTS,
  DIMENSION_ORDER,
  type DimensionScore,
} from "../src/lib/scoring/dimensions.ts";
import { combine, band, withinRegion, MINIMUM_COVERAGE } from "../src/lib/scoring/assess.ts";
import { darkness, sunTimes } from "../src/lib/scoring/sun.ts";
import { summariseOsm } from "../src/lib/scoring/osm.ts";
import { absent, present } from "../src/lib/signal.ts";
import type { CrimeSummary } from "../src/lib/sources/nl-crime.ts";
import { emptyCategoryCounts } from "../src/lib/sources/nl-crime.ts";

const AMSTERDAM = { lat: 52.3728, lng: 4.8936 };

test("the dimension weights sum to one", () => {
  const total = DIMENSION_ORDER.reduce((sum, key) => sum + DIMENSION_WEIGHTS[key], 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
});

test("point and area crime use different curves in different units", () => {
  // The same NUMBER means different things on the two bases, so the two curves
  // must not agree — collapsing them is the bug this guards.
  assert.notEqual(Math.round(areaCrimeScore(10)), Math.round(pointCrimeScore(10)));
  assert.equal(areaCrimeScore(0), 100);
  assert.equal(pointCrimeScore(0), 100);
  assert.ok(areaCrimeScore(5) > areaCrimeScore(50));
  assert.ok(pointCrimeScore(2) > pointCrimeScore(30));
});

test("area evidence is carried at lower confidence than located evidence", () => {
  assert.ok(BASIS_CONFIDENCE.area < BASIS_CONFIDENCE.point);
  assert.equal(BASIS_CONFIDENCE.area, 0.4);
  assert.equal(BASIS_CONFIDENCE.point, 0.55);
});

function summary(overrides: Partial<CrimeSummary> = {}): CrimeSummary {
  return {
    basis: "area",
    table: "47022NED",
    areaCode: "BU03630000",
    areaLevel: "buurt",
    areaName: "Burgwallen-Oude Zijde",
    totalCount: 120,
    byCategory: { ...emptyCategoryCounts(), theft: 100, "violence-against-person": 15, "sexual-offence": 5 },
    monthsRequested: 12,
    monthsObserved: 12,
    observedPeriods: [],
    offencesPerMonth: 10,
    severityPerMonth: 4.2,
    suppressedCells: 0,
    rollUpRowsExcluded: 12,
    ...overrides,
  };
}

test("an unmeasured dimension is null, never a polite 50", () => {
  const dimension = incidentHistory(absent("unreachable", "CBS", "We did not look."));
  assert.equal(dimension.score, null);
  assert.equal(dimension.confidence, 0);
  assert.equal(dimension.why, "We did not look.");
});

test("measured-and-fine reads differently from not-measured", () => {
  const quiet = incidentHistory(present(summary({ totalCount: 0, severityPerMonth: 0 }), "CBS", 0.4));
  assert.equal(quiet.score, 100);
  assert.match(quiet.why, /No offences were recorded/);
  const missing = incidentHistory(absent("not-published", "CBS", "No police figures were returned."));
  assert.equal(missing.score, null);
});

test("a missing signal lowers confidence rather than scoring neutral", () => {
  const all: DimensionScore[] = DIMENSION_ORDER.map((key) => ({
    key,
    label: key,
    score: 80,
    confidence: 0.5,
    basis: "osm",
    why: "",
  }));
  const full = combine(all);
  const half = combine(all.map((dimension, index) => (index % 2 === 0 ? { ...dimension, score: null, confidence: 0 } : dimension)));
  assert.equal(full.score, 80);
  assert.equal(half.score, 80, "the score itself is unchanged — we did not invent a number");
  assert.ok(half.confidence < full.confidence, "but we are less sure of it");
  assert.ok(half.coverage < full.coverage);
});

test("one lucky dimension is not a score — 100 on a screen reads as reassurance", () => {
  // `environment` is computed offline and cannot fail, so it is the dimension
  // left standing when every upstream is down. On its own it must not produce
  // a number.
  const onlyEnvironment: DimensionScore[] = DIMENSION_ORDER.map((key) => ({
    key,
    label: key,
    score: key === "environment" ? 100 : null,
    confidence: key === "environment" ? 0.3 : 0,
    basis: key === "environment" ? "computed" : null,
    why: "",
  }));
  const combined = combine(onlyEnvironment);
  assert.equal(combined.score, null);
  assert.equal(band(combined.score, combined.confidence), "unknown");
  assert.ok(combined.coverage > 0 && combined.coverage < MINIMUM_COVERAGE, `coverage ${combined.coverage}`);
});

test("nothing measured means no score at all, and the band says unknown", () => {
  const none = combine(DIMENSION_ORDER.map((key) => ({ key, label: key, score: null, confidence: 0, basis: null, why: "" })));
  assert.equal(none.score, null);
  assert.equal(band(none.score, none.confidence), "unknown");
});

test("lighting is not measured when there is no map data", () => {
  const osm = summariseOsm([], AMSTERDAM, 300, "none");
  const dimension = lighting(osm, 1, null);
  assert.equal(dimension.score, null);
  assert.match(dimension.why, /gap in the data/);
});

test("the same street scores differently at 3pm and 1am", () => {
  const features = [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `node/${index}`,
      kind: "node",
      point: { lat: AMSTERDAM.lat + index * 0.0001, lng: AMSTERDAM.lng },
      tags: { highway: "street_lamp" },
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `way/${index}`,
      kind: "way",
      point: { lat: AMSTERDAM.lat, lng: AMSTERDAM.lng + index * 0.0001 },
      tags: { highway: "residential", lit: index < 4 ? "yes" : "no" },
    })),
  ];
  const osm = summariseOsm(features, AMSTERDAM, 300, "measured");
  const day = lighting(osm, 0, null).score!;
  const night = lighting(osm, 1, null).score!;
  assert.ok(day > night, `${day} in daylight should beat ${night} after dark`);
});

test("darkness follows the sun, not the clock", () => {
  const summerNoon = new Date("2026-06-21T12:00:00Z");
  const summerMidnight = new Date("2026-06-21T23:30:00Z");
  assert.equal(darkness(summerNoon, AMSTERDAM), 0);
  assert.equal(darkness(summerMidnight, AMSTERDAM), 1);
  const times = sunTimes(summerNoon, AMSTERDAM);
  assert.ok(times.sunrise && times.sunset);
  // Midsummer in Amsterdam: sunrise around 03:19 UTC, sunset around 20:06 UTC.
  assert.ok(times.sunrise.getUTCHours() <= 4, times.sunrise.toISOString());
  assert.ok(times.sunset.getUTCHours() >= 19, times.sunset.toISOString());
});

test("a point outside the Netherlands is out of region, not crime-free", () => {
  assert.equal(withinRegion(AMSTERDAM, "NL"), true);
  assert.equal(withinRegion({ lat: 35.6892, lng: 51.389 }, "NL"), false); // Tehran
  assert.equal(withinRegion({ lat: 35.6892, lng: 51.389 }, "GB"), true);
});

test("OSM coverage distinguishes 'nothing here' from 'we could not look'", () => {
  const nothingHere = summariseOsm([], AMSTERDAM, 300, "measured");
  const couldNotLook = summariseOsm([], AMSTERDAM, 300, "none");
  assert.equal(nothingHere.coverage, "measured");
  assert.equal(couldNotLook.coverage, "none");
});
