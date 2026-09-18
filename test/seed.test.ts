import test from "node:test";
import assert from "node:assert/strict";

import {
  AMSTERDAM_AREAS, buildSeedReports, DEFAULT_SEED_TOTAL,
} from "../src/lib/seed-data.ts";
import { CRIME_CATEGORIES, parseReports } from "../src/lib/reports.ts";
import { databaseName, fromDoc, toDoc } from "../src/lib/db.ts";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");

/* ------------------------------ what it makes ------------------------------ */

test("EVERY seeded report is marked as example data", () => {
  // The one assertion in this file that is not about correctness. A point this
  // file invented, sitting on a real street with `source: "community"`, is a
  // fabricated record of a real place — and the marker, the popup and the
  // panel banner all key off this field.
  const reports = buildSeedReports({ now: NOW });
  assert.ok(reports.length > 0);
  for (const report of reports) {
    assert.equal(report.source, "example", report.id);
  }
});

test("every seeded report still carries source: example in the DATA", () => {
  /*
   * This replaces a test that required every note to begin "Example note —".
   * The notes are now written in the register a real report is written in, on
   * purpose: the app is being evaluated as it will look, and a layer full of
   * visible stubs says nothing about whether the popup, the wrapping or the
   * category filter work. `MARK_EXAMPLE_DATA` in `src/lib/demo-mode.ts` is off
   * for the same reason.
   *
   * What has NOT moved is the `source` field, and this is the test that keeps
   * it. It is the only thing left that can find these rows again:
   * `npm run seed -- --no-demo` and the panel's clear button both select on
   * it, and `--keep` spares real reports by it. Lose the field and the
   * placeholder rows are stranded in the database, indistinguishable from
   * fieldwork, with the on-screen marking off as well.
   */
  const reports = buildSeedReports({ now: NOW });
  assert.ok(reports.length > 0);
  for (const report of reports) {
    assert.equal(report.source, "example", report.id);
  }
});

test("a note matches its own category, and an empty note is allowed", () => {
  // A `catcalling` point carrying a note about a break-in makes the category
  // filter impossible to test — you cannot tell a filtering bug from a data
  // one. `murder` has no note pool at all, and a report with no note is a real
  // state the popup has to render.
  const reports = buildSeedReports({ now: NOW });
  const byCategory = new Map<string, Set<string>>();
  for (const report of reports) {
    if (!report.note) continue;
    const seen = byCategory.get(report.category) ?? new Set<string>();
    seen.add(report.note);
    byCategory.set(report.category, seen);
  }
  // No note is shared between two categories.
  const owners = new Map<string, string>();
  for (const [category, notes] of byCategory) {
    for (const note of notes) {
      const already = owners.get(note);
      assert.ok(
        already === undefined || already === category,
        `"${note}" is used by both ${already} and ${category}`,
      );
      owners.set(note, category);
    }
  }
  assert.ok(reports.some((report) => !report.note), "no report was left without a note");
});

test("the same options give the same data", () => {
  // Otherwise "did the seed change or did I?" has no answer when a reseed
  // makes the map look different.
  const a = buildSeedReports({ now: NOW, seed: 7, total: 40 });
  const b = buildSeedReports({ now: NOW, seed: 7, total: 40 });
  assert.deepEqual(a, b);

  const c = buildSeedReports({ now: NOW, seed: 8, total: 40 });
  assert.notDeepEqual(a, c);
});

test("what it writes survives the same parser the browser uses", () => {
  // The seed writes straight to Mongo, so nothing else would catch a report
  // shaped wrongly — it would simply be dropped on load and the map would be
  // emptier than the seed said it was.
  const reports = buildSeedReports({ now: NOW });
  assert.equal(parseReports(reports).length, reports.length);
});

test("ids are unique, or the upsert overwrites its own rows", () => {
  const reports = buildSeedReports({ now: NOW });
  assert.equal(new Set(reports.map((report) => report.id)).size, reports.length);
});

test("every category it emits is one the filter panel can show", () => {
  const known = new Set(CRIME_CATEGORIES.map((category) => category.id));
  for (const report of buildSeedReports({ now: NOW, total: 400 })) {
    assert.ok(known.has(report.category), report.category);
  }
});

test("points land near the districts they belong to, not at 0,0", () => {
  const byName = new Map(AMSTERDAM_AREAS.map((area) => [area.name, area]));
  for (const report of buildSeedReports({ now: NOW })) {
    const area = byName.get(report.area ?? "");
    assert.ok(area, `unknown area: ${report.area}`);
    // Rough degrees — a kilometre is about 0.009° of latitude here. Anything
    // outside this is a coordinate that went through the wrong conversion.
    assert.ok(Math.abs(report.point.lat - area.centre.lat) < 0.02, report.id);
    assert.ok(Math.abs(report.point.lng - area.centre.lng) < 0.03, report.id);
  }
});

test("the dates run backwards from now, never into the future", () => {
  for (const report of buildSeedReports({ now: NOW, days: 30 })) {
    const at = Date.parse(report.at);
    assert.ok(at <= NOW + 86_400_000, report.at);
    assert.ok(at > NOW - 32 * 86_400_000, report.at);
  }
});

test("the count is roughly what was asked for", () => {
  // Rounding each district's share means it will not be exact; an order of
  // magnitude out would mean the weights are wrong.
  const reports = buildSeedReports({ now: NOW, total: 200 });
  assert.ok(reports.length > 180 && reports.length < 220, String(reports.length));
  assert.ok(buildSeedReports({ now: NOW }).length > DEFAULT_SEED_TOTAL * 0.9);
});

test("asking for nothing writes nothing", () => {
  assert.deepEqual(buildSeedReports({ total: 0 }), []);
  assert.deepEqual(buildSeedReports({ areas: [] }), []);
});

test("murder is not seeded onto anybody's street", () => {
  // Every other category is invented too, but this is the one where a
  // fabricated pin most reads as a factual claim about a specific address.
  const murders = buildSeedReports({ now: NOW, total: 600 })
    .filter((report) => report.category === "murder");
  assert.equal(murders.length, 0);
});

/* -------------------------------- storage --------------------------------- */

test("a report round-trips through the stored document unchanged", () => {
  const [report] = buildSeedReports({ now: NOW, total: 20 });
  assert.ok(report);
  assert.deepEqual(fromDoc(toDoc(report)), report);
});

test("the stored point is GeoJSON — longitude FIRST", () => {
  // The same trap as OSRM. The wrong way round still indexes and still returns
  // results, just for a place in the Gulf of Guinea.
  const doc = toDoc({
    id: "x", category: "other", point: { lat: 52.37, lng: 4.89 },
    at: "2026-01-01T00:00:00.000Z", source: "community",
  });
  assert.deepEqual(doc.loc.coordinates, [4.89, 52.37]);
  assert.equal(doc.atMs, Date.parse("2026-01-01T00:00:00.000Z"));
});

test("the database name comes from the URI, and is never Mongo's default", () => {
  // A URI with no path makes the driver pick `test`, which is a silent write to
  // the wrong database that looks exactly like a working one.
  assert.equal(databaseName("mongodb://127.0.0.1:27017/maddie"), "maddie");
  assert.equal(databaseName("mongodb://127.0.0.1:27017"), "maddie");
  assert.equal(databaseName("mongodb://127.0.0.1:27017/"), "maddie");
  assert.equal(databaseName("mongodb://user:pw@host:27017/maddie?replicaSet=rs0"), "maddie");
  assert.equal(databaseName("mongodb+srv://user:pw@cluster.example/maddie-staging"), "maddie-staging");
  assert.equal(databaseName("not a uri"), "maddie");
});
