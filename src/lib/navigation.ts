/**
 * Where you are on a route, and what to do next. Pure, and tested.
 *
 * This is the arithmetic behind the navigation view: snap a GPS fix onto the
 * planned line, work out how far along that is, which instruction is coming up
 * and how far away it is, and whether the walk has wandered off the route or
 * reached the end.
 *
 * All of it is pure on purpose. The alternative — computing progress inside the
 * component as positions arrive — is the version that cannot be checked: every
 * one of the rules below is a judgement about a person walking down a street at
 * night, and the only way to try them without going outside is to feed
 * positions in and assert on what comes out.
 *
 * ⚠ It says where you are ON THE ROUTE, never where you are in the world. A fix
 * 200 m away still snaps to the nearest point of the line; that is what
 * `offM` is for, and why `offRoute` exists rather than the snapped point being
 * treated as the truth.
 */

import { distanceM } from "./geo.ts";
import type { LatLng, Route, Step } from "./osrm.ts";

/**
 * How far off the line counts as off the route.
 *
 * Generous, because the alternative errs in the expensive direction. A phone's
 * fix drifts tens of metres between buildings, and a pedestrian legitimately
 * walks on either pavement, crosses at a corner, and cuts through a square the
 * router drew as a line. Announcing "you have left the route" at 15 m would do
 * it constantly on exactly the narrow streets this app is for — and an alert
 * that cries wolf is one that gets ignored on the night it is right.
 */
export const OFF_ROUTE_M = 45;

/**
 * Off-route is judged against what the device actually knows.
 *
 * A fix carries its own uncertainty, and phones report hundreds of metres of it
 * between buildings, indoors, and on a cold start — which is most of a walk
 * through a dense city at night. Comparing a 120 m offset against a 45 m
 * threshold while the device is only sure to ±100 m announces that somebody has
 * left the route on the evidence that it does not know where they are.
 *
 * That was on screen: a walker standing on the boulevard their route runs
 * along, inside an accuracy circle wider than the street, being told they had
 * gone wrong. So the accuracy is subtracted before the comparison — the
 * question becomes "are they off the route by more than the error bar", which
 * is the only version of it the data can answer.
 */
export function isOffRoute(offM: number, accuracyM: number | null | undefined): boolean {
  const slack = typeof accuracyM === "number" && Number.isFinite(accuracyM) ? Math.max(0, accuracyM) : 0;
  return offM - slack > OFF_ROUTE_M;
}

/** Close enough to the destination to call it arrived. */
export const ARRIVED_M = 25;

/**
 * How close to a turn before it becomes the thing being announced.
 *
 * Walking pace is about 1.4 m/s, so 30 m is roughly twenty seconds' notice —
 * enough to look up and pick the right side of the street, and not so early
 * that the banner is about a turn two blocks away.
 */
export const MANEUVER_NEAR_M = 30;

/** A position from the device, with what the device says about its quality. */
export interface Fix {
  point: LatLng;
  /** Radius of the reported 95% confidence circle, in metres. */
  accuracyM?: number | null;
}

/** A point matched onto the route, and how far along and how far off it is. */
export interface OnPath {
  /** The point on the line nearest the fix. */
  snapped: LatLng;
  /** Metres from the start of the route to `snapped`. */
  alongM: number;
  /** Metres from the fix to the line. */
  offM: number;
  /** The index of the vertex the snapped point sits after. */
  index: number;
}

/**
 * Project a point onto one segment, in the same flattened space `geo.ts` uses.
 *
 * Returns the fraction along the segment as well as the point, because the
 * fraction is what turns a projection into a distance-along.
 */
function projectOnSegment(point: LatLng, a: LatLng, b: LatLng): { at: LatLng; t: number } {
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const px = point.lng * scale;
  const py = point.lat;
  const ax = a.lng * scale;
  const ay = a.lat;
  const bx = b.lng * scale;
  const by = b.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  // A zero-length segment is a point; projecting onto it divides by zero.
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  return { at: { lat: ay + t * dy, lng: (ax + t * dx) / scale }, t };
}

/**
 * The nearest point on a route to a fix, and how far along it is.
 *
 * The whole line is searched rather than only the part ahead. Searching
 * forwards only is the obvious optimisation and it is wrong here: a fix that
 * jumps — and they do, badly, between tall buildings — would drag the progress
 * permanently forwards with no way back, so a walk that briefly teleported two
 * streets on would then report itself as nearly arrived for the rest of the
 * journey. A route has a few hundred vertices; searching all of them costs
 * nothing at one fix per second.
 */
export function locateOnPath(point: LatLng, path: readonly LatLng[]): OnPath | null {
  if (path.length === 0) return null;
  const first = path[0];
  if (!first) return null;
  if (path.length === 1) return { snapped: first, alongM: 0, offM: distanceM(point, first), index: 0 };

  let best: OnPath | null = null;
  let travelled = 0;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const length = distanceM(a, b);
    const { at, t } = projectOnSegment(point, a, b);
    const off = distanceM(point, at);
    if (best === null || off < best.offM) {
      best = { snapped: at, alongM: travelled + length * t, offM: off, index: i - 1 };
    }
    travelled += length;
  }
  return best;
}

/** An instruction, placed on the route by distance rather than by index. */
export interface Milestone {
  step: Step;
  /** Metres from the start of the route to where this maneuver happens. */
  alongM: number;
}

/**
 * Put every instruction on the line, measured the same way a fix is.
 *
 * OSRM sends a distance for each step, and summing those would be the obvious
 * way to get the same numbers. It is not the same measurement: OSRM's distances
 * come from its own network geometry, and the progress of a walker is measured
 * against the simplified polyline this app drew. The two drift by tens of
 * metres over a long route, which is exactly the scale at which "turn in 20 m"
 * has to be right.
 *
 * So the maneuver's own coordinate is snapped onto the line, and everything is
 * then in one measurement space. Computed once per route, not per fix.
 */
export function milestones(steps: readonly Step[], path: readonly LatLng[]): Milestone[] {
  const out: Milestone[] = [];
  for (const step of steps) {
    const found = locateOnPath(step.at, path);
    if (!found) continue;
    out.push({ step, alongM: found.alongM });
  }
  // OSRM sends them in order; snapping cannot reorder them, but a route that
  // doubles back can snap a later maneuver behind an earlier one. Sorting keeps
  // "the next one" meaningful without pretending the ambiguity is not there.
  return out.sort((a, b) => a.alongM - b.alongM);
}

export interface Progress {
  /** Where the fix sits on the line. Null when there is no route to sit on. */
  on: OnPath | null;
  /** Metres still to walk. */
  remainingM: number;
  /** Seconds still to walk, at the pace the router assumed. */
  remainingS: number;
  /** How far the fix is from the line. */
  offM: number;
  /** Far enough off that it is worth saying so. */
  offRoute: boolean;
  /** Close enough to the end to stop. */
  arrived: boolean;
  /** The instruction being walked towards, if there is one. */
  next: Milestone | null;
  /** The one after that — the "Then …" line. */
  after: Milestone | null;
  /** Metres to `next`. Null when there are no instructions. */
  toNextM: number | null;
}

/**
 * Everything the navigation view needs, from one fix.
 *
 * `remainingS` is scaled from the router's own duration by how much of the
 * route is left, rather than measured. That is a real approximation and worth
 * naming: it assumes the rest of the walk goes at the average pace of the whole
 * walk, so a route that ends with a long climb will read optimistic. Measuring
 * it properly means per-step durations and a model of how fast THIS person
 * walks, and a wrong arrival time is a much smaller harm than the wrong turn.
 */
export function progressOn(route: Route, marks: readonly Milestone[], fix: Fix): Progress {
  const on = locateOnPath(fix.point, route.path);
  if (!on) {
    return {
      on: null, remainingM: route.metres, remainingS: route.seconds, offM: Number.POSITIVE_INFINITY,
      offRoute: false, arrived: false, next: null, after: null, toNextM: null,
    };
  }

  const total = route.metres > 0 ? route.metres : 0;
  const remainingM = Math.max(0, total - on.alongM);
  const fraction = total > 0 ? remainingM / total : 0;

  /*
   * Arrival is measured to the END POINT, not from the distance remaining.
   *
   * They differ in the case that matters: a fix that has drifted off the line
   * near the destination can snap to a point with metres still to run while
   * standing on the doorstep — or the reverse, snapping past the end while
   * still a street away. The straight-line distance to the last vertex is the
   * question actually being asked.
   */
  const last = route.path[route.path.length - 1];
  const arrived = last ? distanceM(fix.point, last) <= ARRIVED_M : false;

  /*
   * The next instruction is the first one still ahead.
   *
   * "Ahead" is by distance along the line, not by index, so a fix that snapped
   * backwards for a moment recovers on the next one rather than being stuck
   * announcing a turn already taken.
   */
  const upcoming = marks.filter((mark) => mark.alongM >= on.alongM - 1);
  const next = upcoming[0] ?? null;
  const after = upcoming[1] ?? null;

  return {
    on,
    remainingM,
    remainingS: Math.round(route.seconds * fraction),
    offM: on.offM,
    offRoute: isOffRoute(on.offM, fix.accuracyM),
    arrived,
    next,
    after,
    toNextM: next ? Math.max(0, next.alongM - on.alongM) : null,
  };
}

/*
 * ── Turning a maneuver into words ───────────────────────────────────────────
 *
 * OSRM gives a type and a modifier, not a sentence. The mapping below is
 * deliberately small and deliberately dull: an instruction read while crossing
 * a road has to be understood at a glance, and the failure mode of clever
 * phrasing is a sentence that has to be parsed.
 *
 * An unknown type becomes "Continue" rather than nothing. OSRM has added
 * maneuver types between versions, and a blank banner at a junction is worse
 * than a vague one.
 */

const TURN_WORD: Record<string, string> = {
  left: "Turn left",
  right: "Turn right",
  "slight left": "Bear left",
  "slight right": "Bear right",
  "sharp left": "Sharp left",
  "sharp right": "Sharp right",
  straight: "Carry straight on",
  uturn: "Turn around",
};

/** A short arrow for the banner. Text, not an icon font — one less thing to load. */
export function maneuverGlyph(step: Step | null | undefined): string {
  if (!step) return "↑";
  if (step.type === "arrive") return "◎";
  if (step.type === "depart") return "↑";
  if (step.type.includes("roundabout") || step.type.includes("rotary")) return "↻";
  switch (step.modifier) {
    case "left": return "←";
    case "right": return "→";
    case "slight left": return "↖";
    case "slight right": return "↗";
    case "sharp left": return "↰";
    case "sharp right": return "↱";
    case "uturn": return "↩";
    default: return "↑";
  }
}

/**
 * The instruction, in words.
 *
 * The street name is included when OSRM has one and left out when it does not,
 * rather than filled with "the road" — most footpaths are unnamed, and "Turn
 * left onto the road" reads as a bug at the moment someone is relying on it.
 */
export function instructionFor(step: Step | null | undefined): string {
  if (!step) return "Carry on";
  const onto = step.name ? ` onto ${step.name}` : "";

  switch (step.type) {
    case "depart":
      return step.name ? `Head along ${step.name}` : "Set off";
    case "arrive":
      return "Arrive at your destination";
    case "roundabout":
    case "rotary":
      return "Take the roundabout";
    case "exit roundabout":
    case "exit rotary":
      return `Leave the roundabout${onto}`;
    case "merge":
      return `Merge${onto}`;
    case "fork":
      return step.modifier.includes("left") ? "Keep left at the fork"
        : step.modifier.includes("right") ? "Keep right at the fork"
        : "Carry on at the fork";
    case "end of road":
      return `${TURN_WORD[step.modifier] ?? "Carry on"}${onto}`;
    case "new name":
      return step.name ? `Continue onto ${step.name}` : "Continue";
    case "continue":
      return `${step.modifier && step.modifier !== "straight" ? TURN_WORD[step.modifier] ?? "Continue" : "Continue"}${onto}`;
    case "turn":
      return `${TURN_WORD[step.modifier] ?? "Turn"}${onto}`;
    default:
      return step.name ? `Continue onto ${step.name}` : "Continue";
  }
}

/**
 * "in 40 m", or nothing when the turn is upon you.
 *
 * Rounded to something a person can act on: metre-precision on a reading that
 * is itself accurate to ten metres is false confidence, and it makes the banner
 * flicker on every fix.
 */
export function distanceCue(metres: number | null): string {
  if (metres === null) return "";
  if (metres <= MANEUVER_NEAR_M) return "now";
  if (metres < 100) return `in ${Math.round(metres / 10) * 10} m`;
  if (metres < 1000) return `in ${Math.round(metres / 50) * 50} m`;
  return `in ${(metres / 1000).toFixed(1)} km`;
}

/**
 * An instruction folded into a sentence that already started — "Then …".
 *
 * Only the FIRST letter is lowered. `String.toLowerCase()` on the whole thing
 * is the obvious version and it is wrong: it takes the street name with it, so
 * "Then turn left onto Prinsengracht" shipped as "onto prinsengracht". A street
 * name is a proper noun and it is the one word in the sentence a walker
 * actually matches against a sign.
 *
 * A word that is already all capitals is left alone — "N7", "A10" and their
 * like are names too, and lowering them makes them unreadable.
 */
export function asClause(text: string): string {
  const first = text.slice(0, text.indexOf(" ") === -1 ? text.length : text.indexOf(" "));
  if (first.length > 1 && first === first.toUpperCase()) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Compass bearing from one point to another, in degrees clockwise from north.
 *
 * The same flattened approximation the rest of this file uses. Over the tens of
 * metres a heading is taken across, the error against a proper great-circle
 * bearing is far below what a phone's compass reports anyway.
 */
export function bearingBetween(a: LatLng, b: LatLng): number {
  const scale = Math.cos((a.lat * Math.PI) / 180);
  const dx = (b.lng - a.lng) * scale;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** How far ahead to look when taking a heading off the route. */
export const HEADING_LOOKAHEAD_M = 35;

/**
 * Which way the route is going at a point along it.
 *
 * This, and NOT the device's compass, is what turns the navigation map.
 *
 * A phone's `heading` is only meaningful while moving and is absent or wild
 * when standing still — at a crossing, waiting to cross, which is exactly when
 * somebody looks at the screen. Spinning the whole map because the handset
 * turned in a pocket is worse than useless; it is disorienting at the moment
 * orientation matters most.
 *
 * The route's own direction is stable, is available before the first step is
 * taken, and answers the question actually being asked — which way am I about
 * to walk. It looks ahead rather than at the current segment so the map begins
 * turning into a corner before the corner, the way a driver's eyes do.
 */
export function headingOnPath(
  path: readonly LatLng[],
  alongM: number,
  lookaheadM: number = HEADING_LOOKAHEAD_M,
): number | null {
  if (path.length < 2) return null;

  const at = pointAt(path, alongM);
  const ahead = pointAt(path, alongM + lookaheadM);
  if (!at || !ahead) return null;
  // At the very end there is nothing ahead to aim at; keep the last real
  // heading by looking backwards instead of snapping to north.
  if (at.lat === ahead.lat && at.lng === ahead.lng) {
    const behind = pointAt(path, Math.max(0, alongM - lookaheadM));
    return behind ? bearingBetween(behind, at) : null;
  }
  return bearingBetween(at, ahead);
}

/** The point a given distance along a path, interpolated between vertices. */
export function pointAt(path: readonly LatLng[], alongM: number): LatLng | null {
  if (path.length === 0) return null;
  const first = path[0];
  if (!first) return null;
  if (alongM <= 0) return first;

  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const leg = distanceM(a, b);
    if (run + leg >= alongM) {
      const t = leg === 0 ? 0 : (alongM - run) / leg;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    run += leg;
  }
  return path[path.length - 1] ?? null;
}

/** The clock time you would arrive, given the seconds left. */
export function arrivalAt(remainingS: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + Math.max(0, remainingS) * 1000);
}
