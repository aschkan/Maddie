import test from "node:test";
import assert from "node:assert/strict";

import { compareRoutes, MEANINGFUL_MARGIN } from "../src/lib/compare.ts";
import type { Assessment } from "../src/lib/score.ts";
import type { Route } from "../src/lib/osrm.ts";

function route(metres: number, seconds: number): Route {
  return { path: [{ lat: 52.37, lng: 4.89 }, { lat: 52.38, lng: 4.90 }], metres, seconds, steps: [] };
}

function scored(score: number | null): Assessment {
  return {
    score,
    verdict: score === null ? "unknown" : score >= 70 ? "good" : score >= 45 ? "fair" : "poor",
    confidence: 0.6,
    findings: [],
    light: "night",
    sunDeg: -18,
  };
}

test("the clearly better-lit route is the preferred one", () => {
  const result = compareRoutes(
    [route(1000, 700), route(1200, 850)],
    [scored(45), scored(78)],
  );
  assert.equal(result.preferred, 1);
  assert.equal(result.fastest, 0);
});

test("two routes within noise of each other get no badge at all", () => {
  // 61 and 63 is the same route as far as this data is concerned. Badging one
  // invents a distinction the map does not support.
  const result = compareRoutes([route(1000, 700), route(1100, 720)], [scored(61), scored(63)]);
  assert.equal(result.preferred, null);
  assert.match(result.reason, /too close to call/);
});

test("the margin is the line: one point under is nothing, one point over is something", () => {
  const under = compareRoutes(
    [route(1000, 700), route(1100, 720)],
    [scored(50), scored(50 + MEANINGFUL_MARGIN - 1)],
  );
  assert.equal(under.preferred, null);

  const over = compareRoutes(
    [route(1000, 700), route(1100, 720)],
    [scored(50), scored(50 + MEANINGFUL_MARGIN)],
  );
  assert.equal(over.preferred, 1);
});

test("a single route is never 'preferred' — there is nothing to prefer it to", () => {
  const result = compareRoutes([route(1000, 700)], [scored(90)]);
  assert.equal(result.preferred, null);
  assert.equal(result.fastest, 0);
  assert.match(result.reason, /nothing to compare/i);
});

test("routes the map says nothing about are not ranked", () => {
  // `score: null` is the unknown verdict — too little map data to judge. It
  // must not win by default, and it must not lose by default either.
  const result = compareRoutes(
    [route(1000, 700), route(1200, 800)],
    [scored(null), scored(null)],
  );
  assert.equal(result.preferred, null);
  assert.match(result.reason, /too little/i);
});

test("one judged route and one unknown one is still nothing to compare", () => {
  const result = compareRoutes(
    [route(1000, 700), route(1200, 800)],
    [scored(88), scored(null)],
  );
  assert.equal(result.preferred, null);
  assert.match(result.reason, /nothing to compare it against/i);
});

test("a route still being read counts as no opinion, not as a zero", () => {
  const result = compareRoutes([route(1000, 700), route(1200, 800)], [scored(80), null]);
  assert.equal(result.preferred, null);
});

test("whatever is said about a preferred route, it is not called safe", () => {
  // The word on the badge and in this sentence is the whole claim. "Safe" is a
  // promise nothing in this app can keep.
  const result = compareRoutes(
    [route(1000, 700), route(1200, 850)],
    [scored(40), scored(85)],
  );
  assert.doesNotMatch(result.reason, /\bsafe\b(?! —)/i);
  assert.match(result.reason, /not safe/i);
});

test("no routes is an empty answer rather than an exception", () => {
  const result = compareRoutes([], []);
  assert.equal(result.preferred, null);
  assert.equal(result.fastest, null);
});
