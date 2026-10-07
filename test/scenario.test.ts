import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { aroundHour, placesAlong, reportsAlong } from "../src/lib/alongside.ts";
import { reportAge } from "../src/lib/reports.ts";
import {
  legKey, parseRecording, recordedLeg, scenarioReports,
  SCENARIO_DESTINATIONS, SCENARIO_NOW, SCENARIO_PROFILES, SCENARIO_START,
} from "../src/lib/scenario.ts";
import type { Report } from "../src/lib/reports.ts";

/*
 * The study scenario: every participant must see the same thing. These pin
 * that the parts which decide what they see are fixed, and that the committed
 * recording is complete enough to run a session from.
 */

test("the scenario's reports are the same on every call", () => {
  assert.deepEqual(scenarioReports(), scenarioReports());
});

test("the scenario's reports are invented, in Utrecht, and say so in the data", () => {
  const reports = scenarioReports();
  assert.ok(reports.length >= 50, `${reports.length} reports is too few to compare routes on`);
  for (const report of reports) {
    // `source` is what keeps them findable as invented, whatever the screen shows.
    assert.equal(report.source, "example");
    assert.match(report.id, /^scenario-/);
    assert.ok(report.point.lat > 52.06 && report.point.lat < 52.13, `${report.id} is not in Utrecht`);
    assert.ok(report.point.lng > 5.07 && report.point.lng < 5.2, `${report.id} is not in Utrecht`);
  }
});

test("the scenario's reports span every age the legend shows", () => {
  const ages = new Set(scenarioReports().map((report) => reportAge(report.at, SCENARIO_NOW)));
  assert.deepEqual([...ages].sort(), ["older", "recent", "year"]);
});

test("the recording parser keeps good legs and refuses junk", () => {
  assert.equal(parseRecording(null), null);
  assert.equal(parseRecording({ legs: {} }), null);
  const route = {
    path: [{ lat: 52.09, lng: 5.11 }, { lat: 52.1, lng: 5.12 }], metres: 1500, seconds: 1100,
    facts: { samples: 1 }, reads: [],
  };
  const parsed = parseRecording({ legs: { "a|walking": [route, { path: [] }], "b|walking": "nope" } });
  assert.ok(parsed);
  assert.equal(parsed.legs["a|walking"]?.length, 1);
  assert.equal(parsed.legs["b|walking"], undefined);
  assert.deepEqual(parsed.layers.spots, []);
});

test("asking for a mode that was not recorded is no routes, never a live request", () => {
  const parsed = parseRecording({ legs: { [legKey("x", "walking")]: [{
    path: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], metres: 1, seconds: 1, facts: {}, reads: [],
  }] } });
  assert.equal(recordedLeg(parsed, "x", "driving").length, 0);
  assert.equal(recordedLeg(parsed, null, "walking").length, 0);
  assert.equal(recordedLeg(parsed, "x", "walking").length, 1);
});

test("the committed recording can run a session: every destination, every mode, routes to compare", () => {
  const raw = JSON.parse(readFileSync(new URL("../src/lib/scenario-recording.json", import.meta.url), "utf8"));
  const recording = parseRecording(raw);
  assert.ok(recording, "src/lib/scenario-recording.json is empty — run `npm run scenario` and commit it");
  for (const destination of SCENARIO_DESTINATIONS) {
    for (const profile of SCENARIO_PROFILES) {
      const routes = recordedLeg(recording, destination.id, profile);
      // One route is nothing to compare, and comparing is the task.
      assert.ok(routes.length >= 2, `${destination.id} by ${profile}: ${routes.length} route(s)`);
      for (const route of routes) {
        assert.ok(route.reads.length > 10, `${destination.id} by ${profile} has a route with no reads`);
        // Recorded the right way round: starts at the station, ends at B.
        const first = route.path[0];
        assert.ok(first && Math.abs(first.lat - SCENARIO_START.point.lat) < 0.003, "the route does not start at Utrecht Centraal");
      }
    }
  }
  assert.ok(recording.layers.spots.length > 0, "the recording has no places to go");
  assert.ok(recording.layers.lamps.length + recording.layers.litWays.length > 0, "the recording has no lighting");
});

/* ── beside the route ────────────────────────────────────────────────────── */

const LINE = [{ lat: 52.09, lng: 5.11 }, { lat: 52.09, lng: 5.13 }];

function report(id: string, lat: number, lng: number, at = "2026-09-01T22:00:00"): Report {
  return { id, category: "harassment", point: { lat, lng }, at, source: "community" };
}

test("a report a street away is along the route; one three streets away is not", () => {
  const near = report("near", 52.0904, 5.12);   // ~45 m north of the line
  const far = report("far", 52.0935, 5.12);     // ~390 m north
  assert.deepEqual(reportsAlong(LINE, [near, far]).map((r) => r.id), ["near"]);
  assert.deepEqual(reportsAlong([], [near]), []);
});

test("places are counted the same way, a little further out", () => {
  const spot = { id: "s", kind: "transit", label: "Train", icon: "🚉", point: { lat: 52.0908, lng: 5.12 } };
  assert.equal(placesAlong(LINE, [spot]).length, 1);
  assert.equal(placesAlong(LINE, [spot], 50).length, 0);
});

test("around the hour wraps through midnight", () => {
  const late = report("late", 52.09, 5.12, "2026-09-01T23:30:00");
  const early = report("early", 52.09, 5.12, "2026-09-02T01:00:00");
  const noon = report("noon", 52.09, 5.12, "2026-09-02T12:00:00");
  assert.deepEqual(aroundHour([late, early, noon], 0).map((r) => r.id), ["late", "early"]);
  assert.deepEqual(aroundHour([late, early, noon], 13).map((r) => r.id), ["noon"]);
});
