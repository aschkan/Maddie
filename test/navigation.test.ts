import test from "node:test";
import assert from "node:assert/strict";

import {
  ARRIVED_M, MANEUVER_NEAR_M, OFF_ROUTE_M, arrivalAt, asClause, distanceCue, instructionFor,
  bearingBetween, headingOnPath, isOffRoute, locateOnPath, maneuverGlyph, milestones, pointAt,
  progressOn,
} from "../src/lib/navigation.ts";
import { distanceM } from "../src/lib/geo.ts";
import type { LatLng, Route, Step } from "../src/lib/osrm.ts";

const LAT = 52.3731;
/** A degree of longitude here, in metres. */
const PER_DEGREE = 111_320 * Math.cos((LAT * Math.PI) / 180);

/** A point `metres` east of the start of the test line. */
function east(metres: number, offsetM = 0): LatLng {
  return { lat: LAT + offsetM / 111_320, lng: 4.8926 + metres / PER_DEGREE };
}

/** A straight line east, `metres` long, with a vertex every 100 m. */
function line(metres: number): LatLng[] {
  const out: LatLng[] = [];
  for (let d = 0; d <= metres; d += 100) out.push(east(d));
  if (out[out.length - 1]?.lng !== east(metres).lng) out.push(east(metres));
  return out;
}

function step(over: Partial<Step> = {}): Step {
  return { type: "turn", modifier: "left", name: "Prinsengracht", at: east(0), metres: 0, ...over };
}

function route(metres: number, seconds: number, steps: Step[] = []): Route {
  return { path: line(metres), metres, seconds, steps };
}

/* ------------------------------ snapping ---------------------------------- */

test("a point beside the line snaps onto it, and says how far off it was", () => {
  const path = line(1_000);
  const found = locateOnPath(east(400, 12), path);
  assert.ok(found);
  assert.ok(Math.abs(found.alongM - 400) < 5, `expected ~400 m along, got ${found.alongM}`);
  assert.ok(Math.abs(found.offM - 12) < 2, `expected ~12 m off, got ${found.offM}`);
});

test("a point beyond the end clamps to the end rather than running past it", () => {
  // Distance along is what the whole progress reading is built on; letting it
  // exceed the route length would report negative distance remaining.
  const path = line(1_000);
  const found = locateOnPath(east(1_400), path);
  assert.ok(found);
  assert.ok(found.alongM <= 1_001, `snapped past the end: ${found.alongM}`);
});

test("the WHOLE line is searched, not just the part ahead", () => {
  /*
   * A fix that jumps forwards — and they do, badly, between tall buildings —
   * must not drag the progress permanently with it. Searching forwards only is
   * the obvious optimisation and it makes that unrecoverable: the walk would
   * report itself nearly arrived for the rest of the journey.
   */
  const path = line(2_000);
  const jumped = locateOnPath(east(1_800), path);
  assert.ok(jumped && jumped.alongM > 1_700);
  const back = locateOnPath(east(200), path);
  assert.ok(back && back.alongM < 300, `did not recover: ${back?.alongM}`);
});

test("an empty or single-point path is answered, not crashed on", () => {
  assert.equal(locateOnPath(east(0), []), null);
  const one = locateOnPath(east(50), [east(0)]);
  assert.ok(one);
  assert.equal(one.alongM, 0);
  assert.ok(one.offM > 40);
});

/* ----------------------------- milestones --------------------------------- */

test("instructions are placed by SNAPPING, not by summing OSRM's distances", () => {
  /*
   * OSRM measures against its own network geometry; a walker is measured
   * against the simplified line this app drew. The two drift by tens of metres
   * over a long route — exactly the scale at which "turn in 20 m" has to be
   * right. So the maneuver's coordinate is put on the line the same way a fix
   * is, and everything ends up in one measurement space.
   */
  const path = line(1_000);
  const marks = milestones([
    step({ type: "depart", at: east(0), metres: 9_999 }),
    step({ at: east(600), metres: 9_999 }),
  ], path);

  assert.equal(marks.length, 2);
  assert.ok(Math.abs((marks[1]?.alongM ?? 0) - 600) < 5, `got ${marks[1]?.alongM}`);
  // OSRM's own `metres` is nonsense here on purpose, and was ignored.
});

test("milestones come back in order along the route", () => {
  const path = line(1_000);
  const marks = milestones([step({ at: east(800) }), step({ at: east(200) })], path);
  assert.deepEqual(marks.map((m) => Math.round(m.alongM / 100) * 100), [200, 800]);
});

/* ------------------------------ progress ---------------------------------- */

test("progress reports what is left, and which turn is coming", () => {
  const marks_ = [step({ type: "depart", at: east(0) }), step({ at: east(600) }), step({ type: "arrive", at: east(1_000) })];
  const r = route(1_000, 800, marks_);
  const marks = milestones(r.steps, r.path);

  const p = progressOn(r, marks, { point: east(400) });
  assert.ok(Math.abs(p.remainingM - 600) < 5, `remaining ${p.remainingM}`);
  // Scaled from the router's own duration by the fraction left — an
  // approximation, and named as one in the module header.
  assert.ok(Math.abs(p.remainingS - 480) < 10, `remaining ${p.remainingS}s`);
  assert.ok(Math.abs((p.toNextM ?? 0) - 200) < 5, `to next ${p.toNextM}`);
  assert.equal(p.next?.step.type, "turn");
  assert.equal(p.after?.step.type, "arrive");
});

test("a turn already passed is not the one announced", () => {
  const r = route(1_000, 800, [step({ at: east(200) }), step({ at: east(800) })]);
  const marks = milestones(r.steps, r.path);
  const p = progressOn(r, marks, { point: east(500) });
  assert.ok(Math.abs((p.next?.alongM ?? 0) - 800) < 5, `announced the wrong turn: ${p.next?.alongM}`);
});

test("far off the line is off-route; a pavement's width is not", () => {
  /*
   * The threshold errs generous on purpose. A phone's fix drifts tens of metres
   * between buildings, and a walker legitimately uses either pavement and cuts
   * corners the router drew square. An alert that cries wolf on every narrow
   * street is one that gets ignored on the night it is right.
   */
  const r = route(1_000, 800);
  const marks = milestones(r.steps, r.path);

  const beside = progressOn(r, marks, { point: east(400, OFF_ROUTE_M - 15) });
  assert.equal(beside.offRoute, false, "a few metres off the line is normal walking");

  const away = progressOn(r, marks, { point: east(400, OFF_ROUTE_M + 40) });
  assert.equal(away.offRoute, true);
});

test("arrival is measured to the END POINT, not from the distance left", () => {
  /*
   * They differ where it matters. A fix that has drifted near the destination
   * can snap to a point with metres still to run while standing on the
   * doorstep — or snap past the end while still a street away.
   */
  const r = route(1_000, 800);
  const marks = milestones(r.steps, r.path);

  assert.equal(progressOn(r, marks, { point: east(1_000) }).arrived, true);
  assert.equal(progressOn(r, marks, { point: east(1_000 - ARRIVED_M + 5) }).arrived, true);
  assert.equal(progressOn(r, marks, { point: east(800) }).arrived, false);

  // Off to one side of the end, beyond the arrival radius: not arrived, even
  // though snapping puts it at the very end of the line.
  const aside = progressOn(r, marks, { point: east(1_000, ARRIVED_M + 40) });
  assert.ok(Math.abs(aside.remainingM) < 5, "it did snap to the end");
  assert.equal(aside.arrived, false, "but standing 65 m away is not arriving");
});

test("a route with no instructions still reports progress", () => {
  // A server that was not asked for steps, or is too old to send them. The
  // navigation follows the line; it just has no turn banner.
  const r = route(1_000, 800);
  const p = progressOn(r, milestones(r.steps, r.path), { point: east(250) });
  assert.equal(p.next, null);
  assert.equal(p.toNextM, null);
  assert.ok(Math.abs(p.remainingM - 750) < 5);
});

/* ------------------------------- wording ---------------------------------- */

test("an instruction names the street when there is one, and never invents one", () => {
  assert.equal(instructionFor(step({ modifier: "left", name: "Prinsengracht" })), "Turn left onto Prinsengracht");
  // Most footpaths are unnamed. "Turn left onto the road" reads as a bug at the
  // moment somebody is relying on it.
  assert.equal(instructionFor(step({ modifier: "right", name: "" })), "Turn right");
});

test("depart and arrive read as themselves", () => {
  assert.match(instructionFor(step({ type: "depart", name: "Damstraat" })), /Damstraat/);
  assert.equal(instructionFor(step({ type: "arrive", name: "" })), "Arrive at your destination");
});

test("a maneuver type nobody has seen before becomes 'continue', not nothing", () => {
  // OSRM has added types between versions. A blank banner at a junction is
  // worse than a vague one.
  assert.equal(instructionFor(step({ type: "some new osrm thing", name: "", modifier: "" })), "Continue");
  assert.equal(instructionFor(null), "Carry on");
  assert.equal(maneuverGlyph(null), "↑");
});

test("the glyph follows the modifier, and arrival is its own mark", () => {
  assert.equal(maneuverGlyph(step({ modifier: "left" })), "←");
  assert.equal(maneuverGlyph(step({ modifier: "slight right" })), "↗");
  assert.equal(maneuverGlyph(step({ type: "arrive" })), "◎");
  assert.equal(maneuverGlyph(step({ type: "roundabout" })), "↻");
});

test("the distance cue is rounded to something a person can act on", () => {
  // Metre precision on a reading accurate to ten metres is false confidence,
  // and it makes the banner flicker on every fix.
  assert.equal(distanceCue(MANEUVER_NEAR_M - 5), "now");
  assert.equal(distanceCue(64), "in 60 m");
  assert.equal(distanceCue(340), "in 350 m");
  assert.equal(distanceCue(2_400), "in 2.4 km");
  assert.equal(distanceCue(null), "");
});

test("the arrival clock is now plus what is left", () => {
  const now = new Date("2026-09-12T03:14:00Z");
  assert.equal(arrivalAt(180, now).toISOString(), "2026-09-12T03:17:00.000Z");
  // A negative remainder would put arrival in the past, which reads as broken.
  assert.equal(arrivalAt(-60, now).toISOString(), now.toISOString());
});

/* --------------------------- the trap, restated --------------------------- */

test("snapping never claims to know where you are in the WORLD", () => {
  // A fix 300 m away still snaps onto the line. `offM` is the only thing that
  // says the snapped point is fiction, which is why `offRoute` reads it rather
  // than the snapped point being treated as the truth.
  const r = route(1_000, 800);
  const p = progressOn(r, milestones(r.steps, r.path), { point: east(400, 300) });
  assert.ok(p.on);
  assert.ok(distanceM(p.on.snapped, east(400)) < 5, "it snapped to the line, as designed");
  assert.ok(p.offM > 280, "and says how far the fix really was");
  assert.equal(p.offRoute, true);
});

test("a 'Then …' clause lowers only the first word, never the street name", () => {
  /*
   * Shipped wrong once and caught in a screenshot: `.toLowerCase()` on the
   * whole instruction gave "Then turn left onto prinsengracht". A street name
   * is a proper noun, and it is the one word in the sentence a walker actually
   * matches against a sign.
   */
  assert.equal(asClause("Turn left onto Prinsengracht"), "turn left onto Prinsengracht");
  assert.equal(asClause("Arrive at your destination"), "arrive at your destination");
  // An all-capitals first word is a name too — "N7", "A10" — and lowering it
  // makes it unreadable.
  assert.equal(asClause("N7 exit ahead"), "N7 exit ahead");
  assert.equal(asClause(""), "");
});

test("off-route is judged against the accuracy the device reported", () => {
  /*
   * On screen once: a walker standing on the boulevard their route runs along,
   * inside an accuracy circle wider than the street, being told they had gone
   * wrong. Comparing a 120 m offset against a 45 m threshold while the device
   * is only sure to ±100 m announces somebody has left the route on the
   * evidence that it does not know where they are.
   */
  assert.equal(isOffRoute(120, 100), false, "within the error bar is not off-route");
  assert.equal(isOffRoute(120, 10), true, "a good fix 120 m out really is off-route");
  // No accuracy reported at all: the raw threshold, as before.
  assert.equal(isOffRoute(OFF_ROUTE_M + 1, null), true);
  assert.equal(isOffRoute(OFF_ROUTE_M - 1, undefined), false);
  // Nonsense from the device must not turn the check off entirely.
  assert.equal(isOffRoute(500, Number.NaN), true);
  assert.equal(isOffRoute(500, -50), true);
});

test("a poor fix does not raise the off-route warning through progressOn", () => {
  const r = route(1_000, 800);
  const marks = milestones(r.steps, r.path);
  const vague = progressOn(r, marks, { point: east(400, 90), accuracyM: 120 });
  assert.ok(vague.offM > 80, "it really is that far from the line");
  assert.equal(vague.offRoute, false, "but the device does not know that well enough to say so");

  const sure = progressOn(r, marks, { point: east(400, 90), accuracyM: 8 });
  assert.equal(sure.offRoute, true);
});

/* ------------------------------- heading ---------------------------------- */

test("a bearing is degrees clockwise from north", () => {
  const here = east(0);
  assert.ok(Math.abs(bearingBetween(here, east(100)) - 90) < 1, "east is 90");
  assert.ok(Math.abs(bearingBetween(here, east(-100)) - 270) < 1, "west is 270");
  assert.ok(Math.abs(bearingBetween(here, east(0, 100)) - 0) < 1, "north is 0");
  assert.ok(Math.abs(bearingBetween(here, east(0, -100)) - 180) < 1, "south is 180");
  // The same point twice is not a direction; it must not be NaN.
  assert.equal(bearingBetween(here, here), 0);
});

test("the map is turned by the ROUTE's direction, not the device compass", () => {
  /*
   * A phone's heading is only meaningful while moving, and is absent or wild
   * standing still — at a crossing, waiting to cross, which is exactly when
   * somebody looks at the screen. Spinning the map because the handset turned
   * in a pocket is disorienting at the moment orientation matters most.
   */
  const path = line(1_000);
  const heading = headingOnPath(path, 400);
  assert.ok(heading !== null);
  assert.ok(Math.abs(heading - 90) < 2, `this route runs east, got ${heading}`);
});

test("it looks AHEAD, so the map turns into a corner before the corner", () => {
  // East for 500 m, then due north.
  const corner: LatLng[] = [east(0), east(500), { lat: LAT + 500 / 111_320, lng: east(500).lng }];
  const beforeCorner = headingOnPath(corner, 480, 100);
  assert.ok(beforeCorner !== null);
  assert.ok(beforeCorner > 5 && beforeCorner < 85, `should already be swinging north, got ${beforeCorner}`);
});

test("at the very end it keeps the last real heading rather than snapping north", () => {
  const path = line(1_000);
  const atEnd = headingOnPath(path, 1_000);
  assert.ok(atEnd !== null);
  assert.ok(Math.abs(atEnd - 90) < 2, `expected to still face east, got ${atEnd}`);
});

test("a path with nothing to aim along has no heading, rather than zero", () => {
  // Zero is a direction — due north — and reporting it for "we do not know"
  // would turn the map to face north at the moment the data ran out.
  assert.equal(headingOnPath([], 0), null);
  assert.equal(headingOnPath([east(0)], 0), null);
});

test("a point along the path is interpolated, not snapped to a vertex", () => {
  // Snapping would make the camera lurch between vertices as you walk.
  const path = line(1_000);
  const mid = pointAt(path, 250);
  assert.ok(mid);
  assert.ok(Math.abs(distanceM(path[0]!, mid) - 250) < 3);
  assert.deepEqual(pointAt(path, -50), path[0]);
  assert.deepEqual(pointAt(path, 99_999), path[path.length - 1]);
  assert.equal(pointAt([], 0), null);
});
