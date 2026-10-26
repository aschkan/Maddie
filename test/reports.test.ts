import test from "node:test";
import assert from "node:assert/strict";

import {
  addReport, exactDay, inDates, loadReports, MAX_NOTE, MAX_REPORTS, newReportId, parseReport, parseReports, removeReport,
  REPORT_TYPES, saveReports, STORAGE_KEY, type Report,
} from "../src/lib/reports.ts";

const GOOD: Report = {
  id: "r1",
  category: "experienced",
  point: { lat: 52.37, lng: 4.89 },
  at: "2026-01-02T03:04:05.000Z",
  source: "community",
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

test("every Pointer field round-trips through the parser unchanged", () => {
  const full: Report = {
    ...GOOD,
    id: "pointer-x",
    source: "pointer",
    category: "witnessed",
    reasons: ["witnessed", "environment"],
    when: "dark",
    adjustments: ["detour", "fake-call"],
    age: "26-35",
    place: "Utrecht",
    note: "Een verhaal.",
    upvotes: 3,
    form: "v2",
  };
  assert.deepEqual(parseReport(JSON.parse(JSON.stringify(full))), full);
});

test("a report at 0,0 is refused rather than drawn in the Gulf of Guinea", () => {
  assert.deepEqual(parseReports([{ ...GOOD, point: {} }]), []);
  assert.deepEqual(parseReports([{ ...GOOD, point: { lat: "52.37", lng: 4.89 } }]), []);
  assert.deepEqual(parseReports([{ ...GOOD, point: { lat: 91, lng: 4.89 } }]), []);
  assert.deepEqual(parseReports([{ ...GOOD, point: { lat: Number.NaN, lng: 4.89 } }]), []);
});

test("a report in a category nothing knows about is dropped; the first board's categories are mapped", () => {
  assert.deepEqual(parseReports([{ ...GOOD, category: "vandalism" }]), []);
  for (const legacy of ["harassment", "catcalling", "sexual_abuse", "assault", "rape", "murder"]) {
    assert.equal(parseReports([{ ...GOOD, category: legacy }])[0]?.category, "experienced", legacy);
  }
  for (const type of REPORT_TYPES) assert.equal(parseReports([{ ...GOOD, category: type.id }]).length, 1, type.id);
});

test("example data is DROPPED — never shown, never promoted to a real report", () => {
  assert.deepEqual(parseReports([{ ...GOOD, source: "example" }]), []);
  // An unmarked source is a community report, as before.
  assert.equal(parseReports([{ ...GOOD, source: undefined }])[0]?.source, "community");
  assert.equal(parseReports([{ ...GOOD, source: "pointer" }])[0]?.source, "pointer");
});

test("an unreadable timestamp is dropped — the popup would print Invalid Date", () => {
  assert.deepEqual(parseReports([{ ...GOOD, at: "yesterday" }]), []);
  assert.deepEqual(parseReports([{ ...GOOD, at: 1234 }]), []);
});

test("a note is trimmed and capped; an empty one becomes absent", () => {
  assert.equal(parseReports([{ ...GOOD, note: "  followed  " }])[0]?.note, "followed");
  assert.equal(parseReports([{ ...GOOD, note: "   " }])[0]?.note, undefined);
  assert.equal(parseReports([{ ...GOOD, note: "x".repeat(MAX_NOTE + 50) }])[0]?.note?.length, MAX_NOTE);
});

test("unknown reasons, time answers and adjustment ids are dropped, not kept as text", () => {
  const parsed = parseReport({ ...GOOD, reasons: ["experienced", "nonsense", "other"], when: "noon", adjustments: ["detour", "DROP TABLE"] });
  assert.deepEqual(parsed?.reasons, ["experienced"]);
  assert.equal(parsed?.when, undefined);
  assert.deepEqual(parsed?.adjustments, ["detour"]);
});

test("the browser keeps at most MAX_REPORTS, newest last", () => {
  let list: Report[] = [];
  for (let i = 0; i < MAX_REPORTS + 5; i++) list = addReport(list, { ...GOOD, id: `r${i}` });
  assert.equal(list.length, MAX_REPORTS);
  assert.equal(list[list.length - 1]?.id, `r${MAX_REPORTS + 4}`);
  assert.deepEqual(removeReport([GOOD], "r1"), []);
});

test("a new id is short, url-safe and differs between calls", () => {
  const a = newReportId(1_700_000_000_000, 0.1);
  const b = newReportId(1_700_000_000_001, 0.1);
  assert.match(a, /^r[a-z0-9]+$/);
  assert.notEqual(a, b);
});

test("a report dated by a window overlaps a date filter by its window, and has no exact day", () => {
  const ranged = { ...GOOD, at: "2025-11-24T12:00:00.000Z", atUntil: "2026-06-10T12:00:00.000Z" };
  assert.equal(parseReport(ranged)?.atUntil, ranged.atUntil);
  assert.equal(exactDay(ranged), false);
  assert.equal(exactDay(GOOD), true);
  assert.equal(inDates(ranged, "2026-01-01", "2026-01-31"), true);
  assert.equal(inDates(ranged, "2026-07-01", "2026-07-31"), false);
  assert.equal(inDates(GOOD, "2026-01-02", "2026-01-02"), true);
  // An end before the start is not a window.
  assert.equal(parseReport({ ...GOOD, atUntil: "2020-01-01T00:00:00.000Z" })?.atUntil, undefined);
});
