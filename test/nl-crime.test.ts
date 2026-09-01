import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseDataProperties,
  parseCodeList,
  parseTypedDataSet,
  resolveShape,
  pickTopic,
  periodFilter,
  odataQuote,
} from "../src/lib/sources/statline.ts";
import {
  classifyOffence,
  isRollUpLabel,
  monthCodes,
  normaliseLabel,
  summariseCrimeRows,
  CRIME_SEVERITY,
} from "../src/lib/sources/nl-crime.ts";
import type { AreaCode } from "../src/lib/sources/pdok.ts";

const read = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const properties = parseDataProperties(read("47022NED-dataproperties.json"));
const labelRows = parseCodeList(read("47022NED-soortmisdrijf.json"));
const rows = parseTypedDataSet(read("47022NED-typeddataset.json"));
const labels = new Map(labelRows.map((row) => [row.key.trim(), row.title]));

test("GeoDetail is found even though it does not contain the word Dimension", () => {
  const shape = resolveShape(properties);
  assert.ok(shape, "the region column must resolve");
  assert.equal(shape.regionKey, "WijkenEnBuurten");
  assert.equal(shape.periodKey, "Perioden");
  assert.deepEqual(shape.dimensionKeys, ["SoortMisdrijf"]);
});

test("a substring test for 'Dimension' would lose the region column", () => {
  // The bug this guards: "GeoDetail".includes("Dimension") === false.
  assert.equal("GeoDetail".includes("Dimension"), false);
});

test("the topic key is matched by substring, because CBS appends _1", () => {
  const shape = resolveShape(properties);
  assert.ok(shape);
  assert.equal(pickTopic(shape, "geregistreerdemisdrijven"), "GeregistreerdeMisdrijven_1");
});

test("'Misdrijven, totaal' is recognised as a roll-up — the comma is the trap", () => {
  assert.equal(isRollUpLabel("Misdrijven, totaal"), true);
  assert.equal(normaliseLabel("Misdrijven, totaal"), "misdrijven totaal");
  assert.equal(isRollUpLabel("1.6.3 Vermogensmisdrijven, totaal"), true);
  assert.equal(isRollUpLabel("2.5.1 Zedenmisdrijf"), false);
});

test("Dutch offence labels classify into severity categories, not into 'other'", () => {
  assert.equal(classifyOffence("2.5.1 Zedenmisdrijf"), "sexual-offence");
  assert.equal(classifyOffence("3.7.1 Mishandeling"), "violence-against-person");
  assert.equal(classifyOffence("3.7.2 Bedreiging"), "violence-against-person");
  assert.equal(classifyOffence("3.7.4 Moord, doodslag"), "violence-against-person");
  assert.equal(classifyOffence("1.4.5 Straatroof"), "robbery");
  assert.equal(classifyOffence("1.4.6 Overval"), "robbery");
  assert.equal(classifyOffence("1.1.1 Diefstal/inbraak woning"), "burglary");
  assert.equal(classifyOffence("1.2.3 Diefstal van brom-, snor-, fietsen"), "vehicle");
  assert.equal(classifyOffence("1.4.7 Winkeldiefstal"), "theft");
  assert.equal(classifyOffence("2.1.1 Vernieling cq. zaakbeschadiging"), "criminal-damage");
  assert.equal(classifyOffence("2.5.2 Drugshandel"), "drugs");
  assert.equal(classifyOffence("3.9.9 Overige misdrijven"), "other");
});

test("sexual offences carry the heaviest weight, deliberately", () => {
  assert.equal(CRIME_SEVERITY["sexual-offence"], 1);
  assert.ok(CRIME_SEVERITY["sexual-offence"] > CRIME_SEVERITY["violence-against-person"]);
  assert.ok(CRIME_SEVERITY.vehicle < CRIME_SEVERITY.theft);
});

test("month codes are enumerated and skip the lagging months", () => {
  const codes = monthCodes(new Date("2026-09-01T00:00:00Z"), 12);
  assert.equal(codes.length, 12);
  assert.equal(codes.at(-1), "2026MM07");
  assert.equal(codes[0], "2025MM08");
  // No annual code may ever appear: adding 2025JJ00 to twelve months of
  // detail triples the figure.
  assert.ok(codes.every((code) => /^\d{4}MM\d{2}$/.test(code)));
});

test("the period filter enumerates rather than using a lexicographic range", () => {
  const filter = periodFilter("Perioden", ["2026MM06", "2026MM07"]);
  assert.equal(filter, "(Perioden eq '2026MM06' or Perioden eq '2026MM07')");
  assert.ok(!filter.includes(" ge "));
  assert.equal(odataQuote("O'Neill"), "'O''Neill'");
});

const area: AreaCode = { level: "buurt", code: "BU03630000", name: "Burgwallen-Oude Zijde" };

function summarise() {
  const shape = resolveShape(properties);
  assert.ok(shape);
  return summariseCrimeRows({
    rows,
    shape,
    offenceKey: "SoortMisdrijf",
    topicKey: "GeregistreerdeMisdrijven_1",
    labels,
    requestedPeriods: monthCodes(new Date("2026-09-01T00:00:00Z"), 12),
    table: "47022NED",
    area,
  });
}

test("the roll-up row is excluded, so the figures do not double", () => {
  const summary = summarise();
  assert.equal(summary.rollUpRowsExcluded, 12);
  // The fixture's roll-up equals the detail sum per month, so including it
  // would land at exactly twice the truth.
  const rollUpTotal = rows
    .filter((row) => String(row.SoortMisdrijf).trim() === "0.0.0")
    .reduce((sum, row) => sum + Number(row.GeregistreerdeMisdrijven_1 ?? 0), 0);
  assert.equal(summary.totalCount, rollUpTotal);
});

test("null is 'not published', never zero", () => {
  const summary = summarise();
  assert.ok(summary.suppressedCells > 0, "the fixture contains suppressed cells");
  const nulls = rows.filter((row) => row.GeregistreerdeMisdrijven_1 === null).length;
  assert.equal(summary.suppressedCells, nulls);
});

test("the divisor is the months that returned data, not the months requested", () => {
  const summary = summarise();
  assert.equal(summary.monthsObserved, 12);
  assert.equal(summary.monthsRequested, 12);
  assert.ok(Math.abs(summary.offencesPerMonth - summary.totalCount / 12) < 1e-9);
});

test("a short window still divides by what came back", () => {
  const shape = resolveShape(properties);
  assert.ok(shape);
  const partial = rows.filter((row) => ["2026MM06", "2026MM07"].includes(String(row.Perioden)));
  const summary = summariseCrimeRows({
    rows: partial,
    shape,
    offenceKey: "SoortMisdrijf",
    topicKey: "GeregistreerdeMisdrijven_1",
    labels,
    requestedPeriods: monthCodes(new Date("2026-09-01T00:00:00Z"), 12),
    table: "47022NED",
    area,
  });
  assert.equal(summary.monthsObserved, 2);
  assert.equal(summary.monthsRequested, 12);
  assert.ok(Math.abs(summary.offencesPerMonth - summary.totalCount / 2) < 1e-9);
});

test("categories are not dominated by 'other'", () => {
  const summary = summarise();
  assert.ok(summary.totalCount > 0);
  assert.ok(summary.byCategory.other / summary.totalCount < 0.4, JSON.stringify(summary.byCategory));
  assert.ok(summary.byCategory["violence-against-person"] > 0);
});

test("totalCount is the quantity — there are no incidents to count on the area basis", () => {
  const summary = summarise();
  assert.equal(summary.basis, "area");
  assert.ok(summary.totalCount > 0);
});
