import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_ORDER, keysOf, mentionsHarassment, moveKey, normaliseOrder, rankOf } from "../src/lib/importance.ts";

test("a basic keyword read flags harassment and catcalling, in Dutch and English", () => {
  assert.ok(mentionsHarassment("Ik werd hier nageroepen door een groep jongens"));
  assert.ok(mentionsHarassment("Vaak lastiggevallen op weg naar huis"));
  assert.ok(mentionsHarassment("Er is hier veel straatintimidatie"));
  assert.ok(mentionsHarassment("I was catcalled twice"));
  assert.ok(mentionsHarassment("Someone followed me to the station"));
  assert.ok(!mentionsHarassment("Het is hier erg donker en stil"));
  assert.ok(!mentionsHarassment(undefined));
  assert.ok(!mentionsHarassment(""));
});

test("a record with several reasons takes the MOST serious one", () => {
  // "One crate can be more than one data point."
  const both = { category: "environment" as const, reasons: ["environment" as const, "experienced" as const] };
  assert.equal(rankOf(both), DEFAULT_ORDER.indexOf("experienced"));
  assert.deepEqual(keysOf(both), ["environment", "experienced"]);
});

test("the story flag lifts a report to the top by default", () => {
  const vague = { category: "environment" as const, note: "Hij bleef me nafluiten" };
  assert.equal(rankOf(vague), 0);
  assert.equal(rankOf({ category: "environment" as const }), DEFAULT_ORDER.indexOf("environment"));
});

test("the reader's order decides the shade", () => {
  const order = moveKey(DEFAULT_ORDER, "environment", 0);
  assert.equal(order[0], "environment");
  assert.equal(order.length, DEFAULT_ORDER.length);
  assert.equal(rankOf({ category: "environment" as const }, order), 0);
  assert.equal(rankOf({ category: "experienced" as const }, order), 2);
});

test("a stored order is repaired, never trusted", () => {
  assert.deepEqual(normaliseOrder(["other", "nonsense", "other"]), ["other", ...DEFAULT_ORDER.filter((k) => k !== "other")]);
  assert.deepEqual(normaliseOrder(null), DEFAULT_ORDER);
});
