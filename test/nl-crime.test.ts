import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CRIME_SEVERITY,
  NL_CRIME_CATEGORIES,
  andFilters,
  classifyOffence,
  crimeBand,
  isRollUpKey,
  isRollUpLabel,
  monthCodes,
  normaliseLabel,
  odataQuote,
  odataValue,
  parseCodeList,
  periodFilter,
  pickOffenceKey,
  pickTopic,
  regionFilter,
  resolveShape,
  summariseCrimeRows,
  topCategories,
} from "../src/lib/nl-crime.ts";

/*
 * The fixtures are REAL recorded replies from CBS's open OData API for table
 * 47022NED, committed so this runs offline like everything else here. The
 * dataset is one Amsterdam neighbourhood (BU03630000) over twelve months, and
 * it carries the two things that have actually broken this integration: the
 * roll-up row, and nulls that mean "withheld" rather than zero.
 */
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const PROPERTIES = read("47022NED-dataproperties.json");
const OFFENCES = read("47022NED-soortmisdrijf.json");
const DATASET = read("47022NED-typeddataset.json");

/* ----------------------------- the table's shape ---------------------------- */

test("the region column is found, though its type says GeoDetail not Dimension", () => {
  // The trap this exists for: `Type.includes("Dimension")` finds the period
  // and the offence type and silently loses the region. A table whose region
  // column cannot be found reads as unusable, which ends as no crime data at
  // all rather than as an error anybody sees.
  const shape = resolveShape(PROPERTIES);
  assert.ok(shape);
  assert.equal(shape.regionKey, "WijkenEnBuurten");
  assert.equal(shape.periodKey, "Perioden");
  assert.ok(shape.dimensionKeys.includes("SoortMisdrijf"));
  assert.ok(shape.topicKeys.length > 0);
});

test("the count column is found through the suffix CBS appends to it", () => {
  // `GeregistreerdeMisdrijven` is really `GeregistreerdeMisdrijven_1`: CBS
  // appends _1, _2… on a name collision. An exact lookup finds nothing, which
  // reads as a table with no figures in it.
  const shape = resolveShape(PROPERTIES);
  assert.ok(shape);
  assert.equal(pickTopic(shape, "geregistreerdemisdrijven"), "GeregistreerdeMisdrijven_1");
  assert.equal(pickOffenceKey(shape), "SoortMisdrijf");
});

test("a reply that describes nothing is null, not a half-built shape", () => {
  assert.equal(resolveShape(null), null);
  assert.equal(resolveShape({ value: [] }), null);
  assert.equal(resolveShape({ value: [{ Type: "Dimension", Key: "OnlyADimension" }] }), null);
});

/* ------------------------------- the roll-up -------------------------------- */

test("the roll-up row is caught DESPITE the comma in its label", () => {
  // `Misdrijven, totaal` — with a comma. A filter for the literal string
  // "misdrijven totaal" sails past it, the total is summed alongside the rows
  // it totals, and every figure roughly doubles.
  assert.equal(normaliseLabel("Misdrijven, totaal"), "misdrijven totaal");
  assert.ok(isRollUpLabel("Misdrijven, totaal"));
  assert.ok(isRollUpLabel("1.6.3 Vermogensmisdrijven, totaal"));
  assert.ok(isRollUpKey("0.0.0 "));

  // And a real offence row is not mistaken for one.
  assert.ok(!isRollUpLabel("2.5.1 Zedenmisdrijf"));
  assert.ok(!isRollUpKey("2.5.1 "));
});

test("both roll-up rows in the real fixture are excluded from the total", () => {
  const summary = summarise();
  assert.ok(summary.rollUpRowsExcluded > 0, "no roll-up rows were found to exclude");

  // The check that matters: the total is the sum of the detail rows, so it can
  // never be the doubled figure a missed roll-up produces.
  const sumOfCategories = NL_CRIME_CATEGORIES
    .reduce((total, category) => total + summary.byCategory[category], 0);
  assert.equal(summary.totalCount, sumOfCategories);
});

/* ----------------------------- classifying rows ----------------------------- */

test("the offence rules are ordered, and the order is the design", () => {
  // Each of these would be swallowed by a later, broader rule.
  assert.equal(classifyOffence("1.1.1 Diefstal/inbraak woning"), "burglary");
  assert.equal(classifyOffence("1.4.5 Straatroof"), "robbery");
  assert.equal(classifyOffence("Diefstal met geweld"), "robbery");
  assert.equal(classifyOffence("2.5.1 Zedenmisdrijf"), "sexual-offence");
  assert.equal(classifyOffence("Verkrachting"), "sexual-offence");
  assert.equal(classifyOffence("Mishandeling"), "violence-against-person");
  assert.equal(classifyOffence("1.2.3 Diefstal van brom-, snor-, fietsen"), "vehicle");
  assert.equal(classifyOffence("1.4.7 Winkeldiefstal"), "theft");
  assert.equal(classifyOffence("2.1.1 Vernieling cq. zaakbeschadiging"), "criminal-damage");
});

test("an offence nothing matches is `other`, never dropped", () => {
  // Dropped, it would vanish from the total and make the badge understate.
  assert.equal(classifyOffence("Iets volstrekt onbekends"), "other");
});

test("sexual offences carry the heaviest weight, by a long way", () => {
  // Not a detail: colouring by raw total makes a neighbourhood of bicycle
  // thefts identical to one with the same count of assaults.
  for (const category of NL_CRIME_CATEGORIES) {
    if (category === "sexual-offence") continue;
    assert.ok(
      CRIME_SEVERITY["sexual-offence"] > CRIME_SEVERITY[category],
      `sexual-offence should outweigh ${category}`,
    );
  }
  assert.ok(CRIME_SEVERITY.vehicle < CRIME_SEVERITY.robbery);
});

/* -------------------------------- the months -------------------------------- */

test("the most recent month is skipped, because police figures lag", () => {
  // A half-filled month reads on screen as a sudden drop in crime — the one
  // direction a reader acts on without checking.
  const codes = monthCodes(new Date("2026-09-16T00:00:00Z"), 3);
  assert.deepEqual(codes, ["2026MM05", "2026MM06", "2026MM07"]);
  // August is the previous whole month and is deliberately not there.
  assert.ok(!codes.includes("2026MM08"));
});

test("stepping back over a year boundary stays on real months", () => {
  const codes = monthCodes(new Date("2026-02-03T00:00:00Z"), 4);
  assert.deepEqual(codes, ["2025MM09", "2025MM10", "2025MM11", "2025MM12"]);
});

/* -------------------------------- the filter -------------------------------- */

test("periods are ENUMERATED, never compared as a range", () => {
  /*
   * `Perioden ge '2025MM01'` is a lexicographic range, and the same column
   * holds the ANNUAL codes `2025JJ00` — which sort inside it. The year's own
   * total is then added to the twelve months that make it up.
   */
  const filter = periodFilter("Perioden", ["2025MM01", "2025MM02"]);
  assert.equal(filter, "(Perioden eq '2025MM01' or Perioden eq '2025MM02')");
  assert.ok(!filter.includes(" ge "));
  assert.ok(!filter.includes(" le "));
});

test("several neighbourhoods go out as one request", () => {
  const filter = regionFilter("WijkenEnBuurten", ["BU03630000", "BU03630100"]);
  assert.equal(
    filter,
    "(WijkenEnBuurten eq 'BU03630000' or WijkenEnBuurten eq 'BU03630100')",
  );
});

test("an empty list contributes no clause at all", () => {
  // An empty `()` is a syntax error OData answers 400 to, and a 400 is not
  // worth asking a second time.
  assert.equal(periodFilter("Perioden", []), "");
  assert.equal(regionFilter("WijkenEnBuurten", []), "");
  assert.equal(andFilters(["", null, undefined]), "");
  assert.equal(andFilters(["a eq 1", "", "b eq 2"]), "a eq 1 and b eq 2");
});

test("a quote in a value cannot end the quoted string", () => {
  assert.equal(odataQuote("it's"), "'it''s'");
});

/* ------------------------------- summarising -------------------------------- */

function summarise() {
  const shape = resolveShape(PROPERTIES);
  assert.ok(shape);
  const topicKey = pickTopic(shape, "geregistreerdemisdrijven");
  const offenceKey = pickOffenceKey(shape);
  assert.ok(topicKey && offenceKey);
  return summariseCrimeRows({
    rows: odataValue(DATASET),
    shape,
    offenceKey,
    topicKey,
    labels: parseCodeList(OFFENCES),
    requestedPeriods: monthCodes(new Date("2026-09-16T00:00:00Z"), 12),
    areaCode: "BU03630000",
    areaName: "Burgwallen-Oude Zijde",
  });
}

test("a withheld cell is counted as withheld, never as zero", () => {
  /*
   * `null` in this table means NOT PUBLISHED — small-number suppression, to
   * stop an individual being identifiable. Counting it as zero reads on the
   * screen as "nothing happened here", which is the most reassuring possible
   * rendering of missing data.
   */
  const summary = summarise();
  assert.ok(summary.suppressedCells > 0, "the fixture has nulls in it");

  const nulls = odataValue(DATASET)
    .filter((row) => (row as Record<string, unknown>).GeregistreerdeMisdrijven_1 == null).length;
  assert.equal(summary.suppressedCells, nulls);
});

test("the rate divides by the months that ANSWERED, not the months asked for", () => {
  // Dividing by an unfilled window understates the rate by exactly the lag,
  // and the lag is what this table is most reliably wrong about.
  const summary = summarise();
  assert.ok(summary.monthsObserved > 0);
  assert.equal(summary.offencesPerMonth, summary.totalCount / summary.monthsObserved);
  // The fixture covers 2025MM09–2026MM08, which is not the window asked for
  // from a 2026-09 clock — so the two numbers really are different here.
  assert.notEqual(summary.monthsObserved, 0);
});

test("the summary is area-based and says so in the type", () => {
  // Point data and area data are structurally different. `basis` is carried
  // the whole way so nothing downstream can quietly treat one as the other.
  const summary = summarise();
  assert.equal(summary.basis, "area");
  assert.equal(summary.areaCode, "BU03630000");
  assert.equal(summary.table, "47022NED");
});

test("an empty row set is a zero-month summary, not a divide by zero", () => {
  const shape = resolveShape(PROPERTIES);
  assert.ok(shape);
  const summary = summariseCrimeRows({
    rows: [],
    shape,
    offenceKey: "SoortMisdrijf",
    topicKey: "GeregistreerdeMisdrijven_1",
    labels: new Map(),
    requestedPeriods: ["2026MM01"],
    areaCode: "BU00000000",
    areaName: "Nowhere",
  });
  assert.equal(summary.totalCount, 0);
  assert.equal(summary.monthsObserved, 0);
  assert.ok(Number.isFinite(summary.offencesPerMonth));
  assert.ok(Number.isFinite(summary.severityPerMonth));
});

test("the popup's category list is ordered by weight, not by raw count", () => {
  const summary = summarise();
  const top = topCategories(summary);
  for (const entry of top) assert.ok(entry.count > 0, "a zero category reached the popup");
  // Nothing with no offences in it is listed — a row of zeroes is noise under
  // a figure somebody is trying to read.
  assert.ok(top.length <= 4);
});

/* --------------------------------- banding ---------------------------------- */

test("the bands are four, and they climb", () => {
  assert.equal(crimeBand(0), "low");
  assert.equal(crimeBand(4.9), "low");
  assert.equal(crimeBand(5), "medium");
  assert.equal(crimeBand(14.9), "medium");
  assert.equal(crimeBand(15), "high");
  assert.equal(crimeBand(39.9), "high");
  assert.equal(crimeBand(40), "highest");
  assert.equal(crimeBand(4000), "highest");
});

test("a rate that is not a number bands LOW, never the worst one", () => {
  /*
   * Every comparison against NaN is false, so an unguarded ladder of `<`
   * tests falls all the way through and lands on "highest" — the worst thing
   * this layer can say about a neighbourhood, arrived at from arithmetic that
   * produced no number at all. The guard sends both non-finite cases the
   * other way on purpose: with nothing to say, say the quiet thing.
   */
  assert.equal(crimeBand(Number.NaN), "low");
  assert.equal(crimeBand(Number.POSITIVE_INFINITY), "low");
  assert.equal(crimeBand(Number.NEGATIVE_INFINITY), "low");
});

/* ------------------------------ defensive reads ----------------------------- */

test("an unreadable reply is no rows rather than a throw", () => {
  // Same rule as `parseReports`: the far end is a service that can answer with
  // anything, and a map that draws nothing beats a page that does not render.
  assert.deepEqual(odataValue(null), []);
  assert.deepEqual(odataValue({}), []);
  assert.deepEqual(odataValue({ value: "not an array" }), []);
  assert.equal(parseCodeList(null).size, 0);
});

test("the offence labels come back keyed by their TRIMMED code", () => {
  // CBS writes `"1.1.1 "` with a trailing space in the code list and
  // `"1.1.1 "` in the data — but the two have been seen to differ, and a
  // lookup that misses makes every row classify as `other`.
  const labels = parseCodeList(OFFENCES);
  assert.equal(labels.get("1.1.1"), "1.1.1 Diefstal/inbraak woning");
  assert.equal(labels.get("0.0.0"), "Misdrijven, totaal");
});
