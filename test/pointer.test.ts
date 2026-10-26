import test from "node:test";
import assert from "node:assert/strict";

import {
  adjustmentIds, ageBand, parseCsv, parsePointerCsv, POINTER_CREDIT, reasonIds, surveyDate, surveyWhen,
} from "../src/lib/pointer.ts";

/*
 * The Pointer "Onveilige plekken" export. The rows below are shaped like the
 * real file (BOM, `;`, ` | ` multi-values, a quoted story with a newline and
 * a `;` inside it) but are written for the test — the real export is never
 * committed.
 */

const HEADER = "﻿locatie_id;longitude;latitude;plaats;tijdstip;reden_onveilig;gedrag_aanpassing;leeftijd;datum_melding;verhaal;upvotes;versie";
const ROW_V1 = "a1;5.1214;52.0907;Utrecht;Vooral als het donker is;Ik weet dat iemand anders hier iets is overkomen. | Ik vind de omgeving eng, mij kan hier makkelijk iets overkomen.;Ik ga daar niet heen in het donker | Ik rijd/loop/fiets om | Ik laat vrienden/familie weten waar ik ben;26-35 jaar;21/03/2024;;0;v1";
const ROW_V2 = 'b2;4.9;52.37;Amsterdam;Tijdstip maakt niet uit;Er is mij hier iets overkomen.;Ik rijd, loop of fiets om | Anders, Namelijk;75plus;24/11/2025;"Een ""lange"" weg;\nslecht verlicht.";4;v2';

test("the CSV reader honours quotes, doubled quotes, and a newline or ; inside a cell", () => {
  const rows = parseCsv(`${HEADER}\n${ROW_V2}\n`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.[0], "locatie_id");
  assert.equal(rows[1]?.[9], 'Een "lange" weg;\nslecht verlicht.');
  assert.equal(rows[1]?.length, 12);
});

test("a whole export becomes pointer reports with the survey's answers as ids", () => {
  const { reports, skipped } = parsePointerCsv(`${HEADER}\r\n${ROW_V1}\r\n${ROW_V2}\r\n`);
  assert.deepEqual(skipped, []);
  assert.equal(reports.length, 2);
  const [one, two] = reports;
  assert.deepEqual(one, {
    id: "pointer-a1",
    category: "witnessed",
    point: { lat: 52.0907, lng: 5.1214 },
    at: "2024-03-21T12:00:00.000Z",
    source: "pointer",
    reasons: ["witnessed", "environment"],
    when: "dark",
    adjustments: ["not-after-dark", "detour", "tell-someone"],
    age: "26-35",
    place: "Utrecht",
    form: "v1",
  });
  assert.equal(two?.category, "experienced");
  assert.equal(two?.when, "any");
  assert.equal(two?.age, "76+");
  assert.equal(two?.upvotes, 4);
  assert.deepEqual(two?.adjustments, ["detour", "other"]);
  assert.match(two?.note ?? "", /slecht verlicht/);
});

test("v1 and v2 spell the same options differently; both map to one id", () => {
  assert.deepEqual(adjustmentIds("Ik laat vrienden/familie weten waar ik ben"), ["tell-someone"]);
  assert.deepEqual(adjustmentIds("Ik laat vrienden of familie weten waar ik ben"), ["tell-someone"]);
  assert.deepEqual(adjustmentIds("Ik neem ander vervoer (bijvoorbeeld de auto in plaats van de fiets)"), ["other-transport"]);
  assert.deepEqual(adjustmentIds("Nee"), ["none"]);
  assert.deepEqual(reasonIds("Er is mij hier iets overkomen."), ["experienced"]);
});

test("ages: every spelling in the export lands on a band, and nonsense on none", () => {
  assert.equal(ageBand("Jonger dan 12 jaar"), "<12");
  assert.equal(ageBand("Jonger_12"), "<12");
  assert.equal(ageBand("76 jaar of ouder"), "76+");
  assert.equal(ageBand("12-17 jaar"), "12-17");
  assert.equal(ageBand(""), undefined);
  assert.equal(ageBand("oud"), undefined);
});

test("a row with no coordinate or no date is skipped and SAID, never placed at 0,0", () => {
  const bad = `${HEADER}\nc3;;;X;;;;;21/03/2024;;0;v1\nd4;5;52;X;;;;;gisteren;;0;v1\n`;
  const { reports, skipped } = parsePointerCsv(bad);
  assert.equal(reports.length, 0);
  assert.deepEqual(skipped.map((s) => s.line), [2, 3]);
});

test("a file that is not a Pointer export is refused with the missing columns named", () => {
  assert.throws(() => parsePointerCsv("a;b\n1;2\n"), /missing column/);
});

test("dates: dd/mm/yyyy at noon UTC, and an impossible date is null", () => {
  assert.equal(surveyDate("08/07/2026"), "2026-07-08T12:00:00.000Z");
  assert.equal(surveyDate("31/02/2026"), null);
});

test("the credit line is the one Pointer asks for", () => {
  assert.match(POINTER_CREDIT, /Pointer \(KRO-NCRV\)/);
  assert.match(POINTER_CREDIT, /AD/);
});

test("a v2 row dated with the map's whole window is KEPT as a window, never a fake day", () => {
  assert.deepEqual(surveyWhen("24-11-2025 - 10-06-2026"), { at: "2025-11-24T12:00:00.000Z", until: "2026-06-10T12:00:00.000Z" });
  assert.deepEqual(surveyWhen("21/03/2024"), { at: "2024-03-21T12:00:00.000Z" });
  assert.equal(surveyWhen("10-06-2026 - 24-11-2025"), null, "a window that ends before it starts");
  assert.equal(surveyWhen(""), null);
  const row = ROW_V2.replace("24/11/2025", "24-11-2025 - 10-06-2026");
  const { reports } = parsePointerCsv(`${HEADER}
${row}
`);
  assert.equal(reports[0]?.at, "2025-11-24T12:00:00.000Z");
  assert.equal(reports[0]?.atUntil, "2026-06-10T12:00:00.000Z");
});
