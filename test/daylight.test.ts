import test from "node:test";
import assert from "node:assert/strict";

import {
  crudeLight, lightAt, lightFromElevation, minutesAfterSunset, minutesUntilSunset,
  plannedAt, solarElevationDeg, sunTimes,
} from "../src/lib/daylight.ts";
import { assess } from "../src/lib/score.ts";
import type { RouteFacts } from "../src/lib/overpass.ts";

const AMSTERDAM = { lat: 52.3728, lng: 4.8936 };
const REYKJAVIK = { lat: 64.1466, lng: -21.9426 };
const TEHRAN = { lat: 35.6892, lng: 51.389 };
const LONGYEARBYEN = { lat: 78.2232, lng: 15.6267 };

/* ------------------------------- the sun itself ---------------------------- */

test("sunset lands where the almanac puts it", () => {
  // Amsterdam on the summer solstice: 22:06 local, which is 20:06 UTC. A minute
  // either way is far finer than anything downstream of this can use.
  const { sunset } = sunTimes(new Date("2026-06-21T12:00:00Z"), AMSTERDAM);
  assert.ok(sunset, "the sun does set in Amsterdam in June");
  assert.equal(sunset.getUTCHours(), 20);
  assert.ok(Math.abs(sunset.getUTCMinutes() - 6) <= 2, `got :${sunset.getUTCMinutes()}`);
});

test("and moves by five hours between the solstices", () => {
  const summer = sunTimes(new Date("2026-06-21T12:00:00Z"), AMSTERDAM).sunset;
  const winter = sunTimes(new Date("2026-12-21T12:00:00Z"), AMSTERDAM).sunset;
  assert.ok(summer && winter);
  // 20:06 UTC against 15:28 UTC.
  assert.equal(winter.getUTCHours(), 15);
  assert.ok(summer.getUTCHours() - winter.getUTCHours() > 4);
});

test("22:00 in Amsterdam in June is not dark, and the old rule said it was", () => {
  // The bug this module exists for. `hour >= 20` called this night, and
  // lighting carries four times the weight at night as by day — so the verdict
  // turned on a fact about a clock rather than about the sky.
  const at = new Date("2026-06-21T20:00:00Z");   // 22:00 CEST
  assert.equal(crudeLight(22), "night");
  assert.equal(lightAt(at, AMSTERDAM), "day");
});

test("18:30 in Tehran in December IS dark, and the old rule said it was day", () => {
  // The same error the other way round: the sun set an hour and a half earlier.
  const at = new Date("2026-12-21T15:00:00Z");   // 18:30 +0330
  assert.equal(crudeLight(18), "day");
  assert.equal(lightAt(at, TEHRAN), "night");
  const since = minutesAfterSunset(at, TEHRAN);
  assert.ok(since !== null && since > 80 && since < 110, `${since} min after sunset`);
});

test("Reykjavik in June is light at 23:00", () => {
  const at = new Date("2026-06-21T23:00:00Z");
  assert.equal(lightAt(at, REYKJAVIK), "day");
  assert.ok((minutesUntilSunset(at, REYKJAVIK) ?? 0) > 30);
});

test("dusk is its own state, not folded into either neighbour", () => {
  // Half an hour after the Amsterdam winter sunset: the sun is down, but only
  // a few degrees down. Reported as night it overstates the case; reported as
  // day it understates it.
  const at = new Date("2026-12-21T16:00:00Z");
  assert.equal(lightAt(at, AMSTERDAM), "twilight");
  const deg = solarElevationDeg(at, AMSTERDAM);
  assert.ok(deg < 0 && deg > -6, `${deg.toFixed(1)}° should be inside civil twilight`);
});

test("the three states are cut at the horizon and at civil twilight", () => {
  assert.equal(lightFromElevation(10), "day");
  assert.equal(lightFromElevation(0), "day");        // the disc is still visible
  assert.equal(lightFromElevation(-3), "twilight");
  assert.equal(lightFromElevation(-6.1), "night");
  assert.equal(lightFromElevation(-40), "night");
});

test("the polar day is reported as one, not as an Invalid Date", () => {
  // An acos outside its domain is NaN, and a NaN date prints as "Invalid Date"
  // under a safety verdict. The sun being up for a month is a real answer.
  const summer = sunTimes(new Date("2026-06-21T12:00:00Z"), LONGYEARBYEN);
  assert.equal(summer.sunset, null);
  assert.equal(summer.alwaysUp, true);
  assert.equal(summer.alwaysDown, false);

  const winter = sunTimes(new Date("2026-12-21T12:00:00Z"), LONGYEARBYEN);
  assert.equal(winter.sunrise, null);
  assert.equal(winter.alwaysDown, true);
  assert.equal(lightAt(new Date("2026-12-21T12:00:00Z"), LONGYEARBYEN), "night");
});

test("midday is the high point of the day, wherever it is", () => {
  for (const place of [AMSTERDAM, REYKJAVIK, TEHRAN]) {
    const { sunrise, sunset } = sunTimes(new Date("2026-03-21T12:00:00Z"), place);
    assert.ok(sunrise && sunset);
    const noon = new Date((sunrise.getTime() + sunset.getTime()) / 2);
    const midday = solarElevationDeg(noon, place);
    assert.ok(midday > solarElevationDeg(sunrise, place));
    assert.ok(midday > solarElevationDeg(sunset, place));
  }
});

test("an hour is read in the viewer's own timezone", () => {
  const at = plannedAt(22, new Date("2026-06-21T09:13:44.123Z"));
  assert.equal(at.getHours(), 22);
  assert.equal(at.getMinutes(), 0);
  assert.equal(at.getSeconds(), 0);
  // Same day, moved to the hour asked for — not the next one.
  assert.equal(at.getDate(), new Date("2026-06-21T09:13:44.123Z").getDate());
});

test("an out-of-range hour is clamped rather than rolled into another day", () => {
  assert.equal(plannedAt(25, new Date("2026-06-21T09:00:00Z")).getHours(), 23);
  assert.equal(plannedAt(-4, new Date("2026-06-21T09:00:00Z")).getHours(), 0);
});

/* ---------------------- what it does to the verdict ------------------------ */

function facts(over: Partial<RouteFacts> = {}): RouteFacts {
  return {
    lengthM: 1000, samples: 40, litSamples: 0, unlitSamples: 0, unknownLitSamples: 40,
    footwaySamples: 0, greenSamples: 0, lamps: 0, venues: 0, crossings: 0, tunnels: 0,
    ...over,
  };
}

test("the same unlit route scores worse once the sun is actually down", () => {
  const dark = facts({ unlitSamples: 36, unknownLitSamples: 4, lamps: 2, venues: 0 });

  const lateJune = assess(dark, { hour: 22, point: AMSTERDAM, at: new Date("2026-06-21T20:00:00Z") });
  const lateDecember = assess(dark, { hour: 22, point: AMSTERDAM, at: new Date("2026-12-21T21:00:00Z") });

  assert.equal(lateJune.light, "day");
  assert.equal(lateDecember.light, "night");
  assert.ok(lateJune.score !== null && lateDecember.score !== null);
  assert.ok(
    lateJune.score > lateDecember.score,
    `22:00 in June (${lateJune.score}) should not be judged like 22:00 in December (${lateDecember.score})`,
  );
});

test("dusk sits between the two, never at one end", () => {
  const dark = facts({ unlitSamples: 36, unknownLitSamples: 4, lamps: 2 });
  const day = assess(dark, { hour: 12, point: AMSTERDAM, at: new Date("2026-12-21T11:00:00Z") });
  const dusk = assess(dark, { hour: 17, point: AMSTERDAM, at: new Date("2026-12-21T16:00:00Z") });
  const night = assess(dark, { hour: 20, point: AMSTERDAM, at: new Date("2026-12-21T19:00:00Z") });

  assert.deepEqual([day.light, dusk.light, night.light], ["day", "twilight", "night"]);
  assert.ok(day.score !== null && dusk.score !== null && night.score !== null);
  assert.ok(day.score > dusk.score, `${day.score} > ${dusk.score}`);
  assert.ok(dusk.score > night.score, `${dusk.score} > ${night.score}`);
});

test("a worked-out sun is stated; a guessed one is marked as guessed", () => {
  const lit = facts({ litSamples: 30, unknownLitSamples: 10, lamps: 25 });

  const known = assess(lit, { hour: 21, point: AMSTERDAM, at: new Date("2026-12-21T20:00:00Z") });
  assert.ok(typeof known.sunDeg === "number");
  assert.match(known.findings.join(" "), /sun set .* before that hour/);

  // No point to stand on: the hour alone is all there is, and nothing may be
  // said about a sunset that was never computed.
  const guessed = assess(lit, { hour: 21 });
  assert.equal(guessed.sunDeg, null);
  assert.doesNotMatch(guessed.findings.join(" "), /sun/i);
});

test("the sun is never mentioned in daylight — there is nothing to say", () => {
  const noon = assess(
    facts({ litSamples: 30, unknownLitSamples: 10, lamps: 25 }),
    { hour: 12, point: AMSTERDAM, at: new Date("2026-06-21T10:00:00Z") },
  );
  assert.equal(noon.light, "day");
  assert.doesNotMatch(noon.findings.join(" "), /horizon|sun set/i);
});

test("an unmapped route is still 'unknown' at every hour of the day", () => {
  // The light state must never rescue a route the map says nothing about.
  for (const at of ["2026-06-21T10:00:00Z", "2026-06-21T20:00:00Z", "2026-12-21T20:00:00Z"]) {
    const result = assess(facts(), { hour: 12, point: AMSTERDAM, at: new Date(at) });
    assert.equal(result.verdict, "unknown");
    assert.equal(result.score, null);
  }
});
