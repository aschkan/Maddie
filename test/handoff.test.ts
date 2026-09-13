import test from "node:test";
import assert from "node:assert/strict";

import { MAX_WAYPOINTS, googleMapsLink, simplify } from "../src/lib/handoff.ts";
import { distanceToPathM } from "../src/lib/geo.ts";
import type { LatLng } from "../src/lib/osrm.ts";

const LAT = 52.3731;
const PER_DEG = 111_320 * Math.cos((LAT * Math.PI) / 180);
const p = (eastM: number, northM: number = 0): LatLng => ({
  lat: LAT + northM / 111_320,
  lng: 4.8926 + eastM / PER_DEG,
});

/** A straight run east with a vertex every 50 m. */
function straight(metres: number): LatLng[] {
  const out: LatLng[] = [];
  for (let m = 0; m <= metres; m += 50) out.push(p(m));
  return out;
}

/** East, then a hard dogleg north and back — the shape a waypoint must hold. */
function dogleg(): LatLng[] {
  const out: LatLng[] = [];
  for (let m = 0; m <= 500; m += 50) out.push(p(m));
  for (let n = 50; n <= 300; n += 50) out.push(p(500, n));
  for (let m = 550; m <= 1000; m += 50) out.push(p(m, 300));
  for (let n = 250; n >= 0; n -= 50) out.push(p(1000, n));
  return out;
}

/* ------------------------------ simplifying -------------------------------- */

test("a route within the budget keeps every point it has", () => {
  const short = [p(0), p(100), p(200), p(300)];
  assert.deepEqual(simplify(short), [p(100), p(200)]);
});

test("a long route is cut to the budget, never over it", () => {
  /*
   * Nine is not a number to tune — it is the documented ceiling of Google's URL
   * scheme, and going over does not degrade gracefully: the link is rejected
   * and the navigation does not start at all.
   */
  for (const metres of [2_000, 10_000, 40_000]) {
    const kept = simplify(straight(metres));
    assert.ok(kept.length <= MAX_WAYPOINTS, `${metres} m gave ${kept.length} waypoints`);
  }
});

test("the budget is spent on CORNERS, not on even spacing", () => {
  /*
   * The whole reason this is Douglas–Peucker and not every-nth-point. Even
   * spacing spends its budget on long straights, where Google would have gone
   * the same way unprompted, and has nothing left for the one corner where our
   * route and the fast route part company — the only place a waypoint works.
   */
  const route = dogleg();
  const kept = simplify(route);
  const corners = [p(500), p(500, 300), p(1000, 300)];
  for (const corner of corners) {
    const nearest = Math.min(...kept.map((k) => distanceToPathM(k, [corner, corner])));
    assert.ok(nearest < 60, `no waypoint near the corner at ${JSON.stringify(corner)} (nearest ${Math.round(nearest)} m)`);
  }
});

test("a straight route needs no waypoints to be followed", () => {
  // Nothing to pin: Google will draw the same line unprompted, and spending
  // waypoints here would be spending them on nothing.
  const kept = simplify(straight(3_000));
  assert.ok(kept.length <= 2, `a straight line took ${kept.length} waypoints`);
});

test("a route with nothing between its ends has no waypoints", () => {
  assert.deepEqual(simplify([p(0), p(100)]), []);
  assert.deepEqual(simplify([p(0)]), []);
  assert.deepEqual(simplify([]), []);
});

/* -------------------------------- the link --------------------------------- */

test("the link carries OUR route, not just the destination", () => {
  /*
   * The failure this exists to avoid: opening Google at the destination throws
   * away the entire contribution. Google plans the fastest route, which is the
   * one this app exists to disagree with.
   */
  const out = googleMapsLink(dogleg(), "walking");
  assert.ok(out);
  assert.match(out.url, /^https:\/\/www\.google\.com\/maps\/dir\/\?/);
  assert.match(out.url, /waypoints=/);
  assert.ok(out.waypoints > 0, "a dogleg with no waypoints is not our route");
  assert.ok(out.waypoints <= MAX_WAYPOINTS);
});

test("it starts navigation, in the right mode, from the right place", () => {
  const route = dogleg();
  const out = googleMapsLink(route, "walking");
  assert.ok(out);
  const url = new URL(out.url);
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("travelmode"), "walking");
  // Straight into turn-by-turn rather than a preview somebody has to tap past.
  assert.equal(url.searchParams.get("dir_action"), "navigate");

  const first = route[0];
  const last = route[route.length - 1];
  assert.ok(first && last);
  assert.equal(url.searchParams.get("origin"), `${first.lat.toFixed(6)},${first.lng.toFixed(6)}`);
  assert.equal(url.searchParams.get("destination"), `${last.lat.toFixed(6)},${last.lng.toFixed(6)}`);
});

test("cycling is 'bicycling', which is Google's word for it", () => {
  const out = googleMapsLink(straight(1_000), "cycling");
  assert.ok(out);
  assert.equal(new URL(out.url).searchParams.get("travelmode"), "bicycling");
});

test("the waypoint separator survives encoding", () => {
  // A literal `|` between waypoints. Run through URLSearchParams it becomes
  // something Google ignores, and the route quietly reverts to Google's own.
  const out = googleMapsLink(dogleg(), "walking");
  assert.ok(out);
  const waypoints = new URL(out.url).searchParams.get("waypoints") ?? "";
  assert.ok(waypoints.includes("|"), `separator lost: ${waypoints}`);
  assert.equal(waypoints.split("|").length, out.waypoints);
});

test("it reports how much shape was lost, rather than implying none was", () => {
  /*
   * Nine points cannot reproduce a route, only approximate it. `driftM` is the
   * bound that can actually be stated — the worst distance from our line to the
   * straight lines between the waypoints Google was handed.
   */
  const straightRun = googleMapsLink(straight(3_000), "walking");
  assert.ok(straightRun);
  assert.ok(straightRun.driftM < 5, `a straight line should lose nothing, lost ${straightRun.driftM} m`);

  const bendy = googleMapsLink(dogleg(), "walking");
  assert.ok(bendy);
  assert.ok(bendy.driftM >= 0);
});

test("a route with no line is no link, rather than a broken one", () => {
  assert.equal(googleMapsLink([], "walking"), null);
  assert.equal(googleMapsLink([p(0)], "walking"), null);
});
