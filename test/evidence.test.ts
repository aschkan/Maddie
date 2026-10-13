import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { CITIES } from "../src/lib/cities.ts";
import {
  describeLighting, districtOf, histogram, lightingWithin, monthKeys, niceMax, pointInPolygon, projectAlong,
  REPORT_TYPES, reportType, routeEvidence, runsOf, subPath, summariseInterval, withinBudget,
} from "../src/lib/evidence.ts";
import { exampleReports } from "../src/lib/example-reports.ts";
import { pathLengthM } from "../src/lib/geo.ts";
import type { SampleRead } from "../src/lib/overpass.ts";
import { CRIME_CATEGORIES, type Report } from "../src/lib/reports.ts";

/*
 * The evidence dashboard's arithmetic. `docs/Maddie-Evidence-Dashboard.md` is
 * the spec: decompose, don't aggregate; the unknown is a category.
 */

const line = [{ lat: 52, lng: 5 }, { lat: 52, lng: 5.01 }, { lat: 52, lng: 5.02 }];

function read(alongM: number, lit: SampleRead["lit"], extra: Partial<SampleRead> = {}): SampleRead {
  return { point: { lat: 52, lng: 5 }, alongM, lit, footway: false, green: false, lamps: 0, venues: 0, crossings: 0, ...extra };
}

test("every stored category falls into exactly one of the four dashboard types", () => {
  const ids = new Set(REPORT_TYPES.map((type) => type.id));
  for (const category of CRIME_CATEGORIES) assert.ok(ids.has(reportType(category.id)), category.id);
  assert.equal(reportType("rape"), "assault");
  assert.equal(reportType("something-new"), "other");
});

test("a point is inside its district's outline and nowhere else", () => {
  for (const city of CITIES) {
    for (const district of city.districts) {
      assert.equal(districtOf(city, district.label)?.id, district.id, `${city.id}/${district.id} label`);
    }
  }
  assert.equal(pointInPolygon({ lat: 0, lng: 0 }, CITIES[0]!.districts[0]!.outline), false);
});

test("projecting onto a path gives distance along it and distance off it", () => {
  const total = pathLengthM(line);
  const mid = projectAlong(line, { lat: 52.001, lng: 5.01 });
  assert.ok(Math.abs(mid.alongM - total / 2) < 2, `${mid.alongM} vs ${total / 2}`);
  assert.ok(Math.abs(mid.offM - 111) < 3, `${mid.offM}`);
});

test("a sub-path covers exactly the asked-for share of the length", () => {
  const total = pathLengthM(line);
  const part = subPath(line, 0.25, 0.75);
  assert.ok(Math.abs(pathLengthM(part) - total / 2) < 1);
  assert.deepEqual(subPath(line, 0.75, 0.25), part, "the order of the ends does not matter");
});

test("lighting runs tile the whole route — no gap that is neither lit nor unknown", () => {
  const reads = [read(0, "yes"), read(25, "yes"), read(50, "unknown"), read(75, "no")];
  const runs = runsOf(reads, 100, (r) => r.lit);
  assert.deepEqual(runs.map((run) => run.value), ["yes", "unknown", "no"]);
  assert.equal(runs[0]!.from, 0);
  assert.equal(runs[runs.length - 1]!.to, 1);
  for (let i = 1; i < runs.length; i++) assert.equal(runs[i]!.from, runs[i - 1]!.to);
});

test("unknown is its own share, never folded into lit or unlit", () => {
  const reads = [read(0, "yes"), read(25, "unknown"), read(50, "unknown"), read(75, "no")];
  const evidence = routeEvidence({ path: line, seconds: 600, metres: 100 }, reads, [], []);
  assert.equal(evidence.litPct, 25);
  assert.equal(evidence.unknownPct, 50);
  assert.equal(evidence.unlitPct, 25);
  assert.equal(evidence.minutes, 10);
});

test("an interval's lighting is described without a verdict", () => {
  const runs = runsOf([read(0, "yes"), read(50, "unknown")], 100, (r) => r.lit);
  assert.equal(describeLighting(lightingWithin(runs, 0, 0.4)), "lit throughout");
  assert.equal(describeLighting(lightingWithin(runs, 0.4, 0.6)), "mostly unknown");
  assert.equal(describeLighting(lightingWithin(runs, 0.3, 0.6)), "partly unknown");
  for (const word of ["lit throughout", "mostly lit", "partly unlit", "partly unknown", "mostly unknown"]) {
    assert.doesNotMatch(word, /\b(safe|unsafe|danger)/i);
  }
});

test("reports near a route are placed along it; far ones are not counted", () => {
  const near: Report = { id: "a", category: "other", point: { lat: 52.0002, lng: 5.015 }, at: "2025-01-01T20:00:00Z", source: "example", note: "x" };
  const far: Report = { id: "b", category: "other", point: { lat: 52.01, lng: 5.015 }, at: "2025-01-01T20:00:00Z", source: "community" };
  const evidence = routeEvidence({ path: line, seconds: 60, metres: 1 }, [read(0, "yes")], [], [near, far]);
  assert.deepEqual(evidence.reports.map((mark) => mark.item.id), ["a"]);
  assert.ok(Math.abs(evidence.reports[0]!.at - 0.75) < 0.01);
  const summary = summariseInterval(evidence, 0.6, 0.9);
  assert.equal(summary.reportCount, 1);
  assert.equal(summary.narrative?.id, "a");
  assert.match(summary.reports, /example/);
});

test("the trade-off slider filters routes and never ranks them", () => {
  assert.deepEqual(withinBudget([48, 54, 58], 10), [true, true, true]);
  assert.deepEqual(withinBudget([48, 54, 58], 6), [true, true, false]);
  assert.deepEqual(withinBudget([48, 54, 58], 0), [true, false, false]);
});

test("histograms count into bins and drop what falls outside", () => {
  assert.deepEqual(histogram([0, 1, 1, 23, 24, -1, Number.NaN], 0, 24, 1).slice(0, 2), [1, 2]);
  assert.equal(histogram([0, 1, 1, 23], 0, 24, 1)[23], 1);
  assert.equal(niceMax(124), 150);
  assert.equal(niceMax(35), 40);
});

test("month keys run inclusive from one day to another", () => {
  assert.deepEqual(monthKeys("2025-11-03", "2026-02-01"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.deepEqual(monthKeys("2025-05-01", "2025-05-30"), ["2025-05"]);
});

test("example reports are deterministic, marked as examples, and inside their district", () => {
  for (const city of CITIES) {
    const one = exampleReports(city);
    const two = exampleReports(city);
    assert.deepEqual(one, two);
    assert.ok(one.length > 100);
    for (const report of one) {
      assert.equal(report.source, "example");
      const district = city.districts.find((d) => d.name === report.area);
      assert.ok(district && pointInPolygon(report.point, district.outline), `${report.id} outside ${report.area}`);
    }
  }
});

test("nothing that computes a verdict imports the dashboard's report counting", () => {
  // Reports are context, never inputs (CLAUDE.md § "Beside, never inside").
  for (const file of ["score.ts", "segments.ts", "compare.ts", "evidence.ts"]) {
    const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
    if (file !== "evidence.ts") assert.doesNotMatch(source, /from "\.\/(evidence|example-reports|alongside)\.ts"/, file);
    else assert.doesNotMatch(source, /from "\.\/score\.ts"/, "the evidence boards must not reach for the score");
  }
  assert.ok(readdirSync(new URL("../src/lib/", import.meta.url)).includes("evidence.ts"));
});
