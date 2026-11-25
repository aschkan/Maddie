import test from "node:test";
import assert from "node:assert/strict";

import { classOf, DEFAULT_ORDER, mentionsHarassment, moveKey, normaliseOrder, rankOf } from "../src/lib/importance.ts";

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

test("every report falls into exactly one class: harassment x who, then nothing happened", () => {
  // "If a story is harassment and it happened to me, where does it go?" — one place.
  const harass = "Ik werd hier nageroepen";
  assert.equal(classOf({ category: "experienced", note: harass }), "harassment-me");
  assert.equal(classOf({ category: "witnessed", note: harass }), "harassment-others");
  assert.equal(classOf({ category: "environment", note: harass }), "harassment-others");
  assert.equal(classOf({ category: "experienced" }), "me");
  assert.equal(classOf({ category: "witnessed" }), "others");
  assert.equal(classOf({ category: "environment" }), "feeling");
  assert.equal(classOf({ category: "other" }), "feeling");
  // Both "to me" and "to others": the more direct account.
  assert.equal(classOf({ category: "witnessed", reasons: ["witnessed", "experienced"] }), "me");
  assert.equal(classOf({ category: "environment", reasons: ["environment", "experienced"] }), "me");
});

test("the default order puts harassment that happened to the respondent darkest", () => {
  assert.equal(rankOf({ category: "experienced", note: "I was catcalled" }), 0);
  assert.equal(rankOf({ category: "environment" }), DEFAULT_ORDER.length - 1);
});

test("the reader's order decides the shade", () => {
  const order = moveKey(DEFAULT_ORDER, "feeling", 0);
  assert.equal(order[0], "feeling");
  assert.equal(order.length, DEFAULT_ORDER.length);
  assert.equal(rankOf({ category: "environment" as const }, order), 0);
  assert.equal(rankOf({ category: "experienced" as const }, order), 3);
});

test("a stored order is repaired, never trusted", () => {
  assert.deepEqual(normaliseOrder(["others", "nonsense", "others"]), ["others", ...DEFAULT_ORDER.filter((k) => k !== "others")]);
  assert.deepEqual(normaliseOrder(null), DEFAULT_ORDER);
  // The old keys (v1) are dropped: the default comes back.
  assert.deepEqual(normaliseOrder(["experienced", "harassment", "other"]), DEFAULT_ORDER);
});
