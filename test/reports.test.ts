import test from "node:test";
import assert from "node:assert/strict";

import {
  addReport, CRIME_CATEGORIES, loadReports, MAX_REPORTS, newReportId,
  parseReports, removeReport, saveReports, STORAGE_KEY,
} from "../src/lib/reports.ts";

const GOOD = {
  id: "r1",
  category: "harassment",
  point: { lat: 52.37, lng: 4.89 },
  at: "2026-01-02T03:04:05.000Z",
};

test("a well-formed report survives a round trip through storage", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  assert.equal(saveReports(storage, [GOOD]), true);
  assert.deepEqual(loadReports(storage), [GOOD]);
  assert.ok(store.has(STORAGE_KEY));
});

test("a report at 0,0 is refused rather than drawn in the Gulf of Guinea", () => {
  // Storage is text anything could have written. A missing coordinate that
  // defaults to zero puts a purple marker off the coast of Africa.
  assert.deepEqual(parseReports([{ ...GOOD, point: {} }]), []);
  assert.deepEqual(parseReports([{ ...GOOD, point: { lat: "52.37", lng: 4.89 } }]), []);
  assert.deepEqual(parseReports([{ ...GOOD, point: { lat: 91, lng: 4.89 } }]), []);
  assert.deepEqual(parseReports([{ ...GOOD, point: { lat: Number.NaN, lng: 4.89 } }]), []);
});

test("a report in a category nothing knows about is dropped", () => {
  // Every filter checkbox is a known category, so an unknown one could never
  // be switched on or off — it would be an invisible marker you cannot remove.
  assert.deepEqual(parseReports([{ ...GOOD, category: "vandalism" }]), []);
  assert.equal(parseReports([GOOD]).length, 1);
});

test("every listed category is one the parser will accept", () => {
  for (const category of CRIME_CATEGORIES) {
    assert.equal(parseReports([{ ...GOOD, category: category.id }]).length, 1, category.id);
  }
});

test("an unreadable timestamp is dropped — the popup would print Invalid Date", () => {
  assert.deepEqual(parseReports([{ ...GOOD, at: "yesterday" }]), []);
  assert.deepEqual(parseReports([{ ...GOOD, at: 1234 }]), []);
});

test("a note is trimmed and capped; an empty one becomes absent", () => {
  assert.equal(parseReports([{ ...GOOD, note: "  followed  " }])[0]?.note, "followed");
  assert.equal(parseReports([{ ...GOOD, note: "   " }])[0]?.note, undefined);
  assert.equal(parseReports([{ ...GOOD, note: "x".repeat(500) }])[0]?.note?.length, 280);
});

test("a raw JSON string parses; broken JSON is an empty list, not a crash", () => {
  assert.equal(parseReports(JSON.stringify([GOOD])).length, 1);
  assert.deepEqual(parseReports("{not json"), []);
  for (const bad of [null, undefined, 42, {}, "null"]) {
    assert.deepEqual(parseReports(bad), []);
  }
});

test("one bad entry does not take the good ones with it", () => {
  const parsed = parseReports([GOOD, { ...GOOD, id: "r2", category: "nope" }, { ...GOOD, id: "r3" }]);
  assert.deepEqual(parsed.map((report) => report.id), ["r1", "r3"]);
});

test("the list is capped, keeping the newest", () => {
  let list = Array.from({ length: MAX_REPORTS }, (_, index) => ({ ...GOOD, id: `r${index}` }));
  list = addReport(list, { ...GOOD, id: "newest" });
  assert.equal(list.length, MAX_REPORTS);
  assert.equal(list[list.length - 1]?.id, "newest");
  assert.equal(list[0]?.id, "r1", "the oldest is the one that goes");
});

test("removing a report leaves the rest alone", () => {
  const list = [GOOD, { ...GOOD, id: "r2" }];
  assert.deepEqual(removeReport(list, "r1").map((report) => report.id), ["r2"]);
  assert.equal(removeReport(list, "missing").length, 2);
});

test("a browser that refuses storage costs the note, not the page", () => {
  // Private windows and blocked site data throw on access. A page that cannot
  // save a note is still a page that draws a map.
  const hostile = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
  };
  assert.deepEqual(loadReports(hostile), []);
  assert.equal(saveReports(hostile, [GOOD]), false);
  assert.deepEqual(loadReports(null), []);
  assert.equal(saveReports(null, [GOOD]), true);
});

test("ids do not collide within the same millisecond", () => {
  assert.notEqual(newReportId(1_700_000_000_000, 0.1), newReportId(1_700_000_000_000, 0.9));
});
