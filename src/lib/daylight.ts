/**
 * Where the sun is, at a place and an instant.
 *
 * The safety read turns almost entirely on whether it is dark — lighting moves
 * the night score four times as much as the day one — and "dark" used to be
 * `hour >= 20 || hour < 6`. That is a statement about a clock, not about the
 * sky, and it is wrong wherever the two diverge:
 *
 *   * Reykjavik, 23:00 in June. Broad daylight, scored as night.
 *   * Amsterdam, 22:00 in June. The sun sets at 22:05, scored as night.
 *   * Tehran, 18:30 in December. Ninety minutes past sunset, scored as day.
 *
 * In each case the verdict flips on the wrong fact. So the sun's elevation is
 * worked out instead, from the NOAA solar position equations — arithmetic, no
 * dependency, accurate to about a minute of sunrise, which is far finer than
 * anything downstream of it can use.
 *
 * ⚠ THE HOUR IS READ IN THE VIEWER'S TIMEZONE. `plannedAt` builds the instant
 * from a `Date`, so "22:00" means 22:00 wherever the browser is, and the
 * elevation is then exact for the route's own coordinates. Planning a walk in
 * another timezone is off by the difference between the two — the common case
 * by far is planning a walk where you already are, and carrying a timezone
 * database to close the gap would cost more than the gap is worth. When the
 * place is not known at all, `crudeLight` below is the honest fallback and the
 * assessment says it was used.
 */

import type { LatLng } from "./osrm.ts";

/**
 * How light it is, in the three states that change the answer.
 *
 * `twilight` is civil twilight — the sun below the horizon but less than 6°
 * below it, which is the span where you can still see where you are going and
 * street lighting has not yet become the whole story. Folding it into either
 * neighbour is what produced the two errors above at opposite ends of the day.
 */
export type Light = "day" | "twilight" | "night";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Civil twilight's lower edge, and the sun's own apparent radius at setting. */
const CIVIL_DEG = -6;
/** Refraction plus the solar disc: the sun "sets" with its centre just below. */
const HORIZON_DEG = -0.833;

const MINUTES_PER_DAY = 1440;

/** Days into the UTC year, 1 on 1 January. */
function dayOfYearUtc(at: Date): number {
  const start = Date.UTC(at.getUTCFullYear(), 0, 1);
  const here = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  return Math.round((here - start) / 86_400_000) + 1;
}

function utcMinutes(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes() + at.getUTCSeconds() / 60;
}

/**
 * The two terms every other formula here needs.
 *
 * `eqtime` is the equation of time in minutes — the gap between clock noon and
 * the sun actually being overhead, which swings by a quarter of an hour across
 * the year. `decl` is the sun's declination in radians: the seasons.
 */
function solarTerms(at: Date): { eqtime: number; decl: number } {
  const gamma =
    ((2 * Math.PI) / 365) * (dayOfYearUtc(at) - 1 + (utcMinutes(at) / 60 - 12) / 24);

  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  return { eqtime, decl };
}

/**
 * How far the sun is above the horizon, in degrees. Negative is below it.
 *
 * This is the one number the rest of the app needs: it is continuous, it is
 * checkable against any almanac, and it does not care what a clock says.
 */
export function solarElevationDeg(at: Date, point: LatLng): number {
  const { eqtime, decl } = solarTerms(at);

  // True solar time at this longitude. Four minutes per degree of longitude;
  // no timezone term, because everything here is already in UTC.
  const trueSolarMinutes = utcMinutes(at) + eqtime + 4 * point.lng;
  const hourAngle = trueSolarMinutes / 4 - 180;

  const lat = point.lat * RAD;
  const cosZenith =
    Math.sin(lat) * Math.sin(decl) +
    Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle * RAD);

  // Rounding can push this a hair outside [-1, 1], and acos returns NaN there.
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) * DEG;
}

/** The elevation, in the three states that change the score. */
export function lightFromElevation(elevationDeg: number): Light {
  if (elevationDeg > HORIZON_DEG) return "day";
  if (elevationDeg > CIVIL_DEG) return "twilight";
  return "night";
}

export function lightAt(at: Date, point: LatLng): Light {
  return lightFromElevation(solarElevationDeg(at, point));
}

/**
 * The old rule, kept for when there is no place to work the real one out from.
 *
 * `assess` falls back to this when it is handed an hour and nothing else, and
 * says so in the assessment rather than passing it off as a sunset. It is a
 * reasonable guess at a mid-latitude and wrong by hours at a high one.
 */
export function crudeLight(hour: number): Light {
  return hour >= 20 || hour < 6 ? "night" : "day";
}

export interface SunTimes {
  /** UTC instants. Null on a day the sun does not cross that angle at all. */
  sunrise: Date | null;
  sunset: Date | null;
  /** True inside the polar day or polar night, where the pair is meaningless. */
  alwaysUp: boolean;
  alwaysDown: boolean;
}

/**
 * Sunrise and sunset for the UTC day `at` falls in.
 *
 * Above the Arctic and Antarctic circles the sun may not cross the horizon at
 * all, and the hour angle is then an `acos` of something outside [-1, 1].
 * That is a real answer about the world — the sun is up all day, or down all
 * day — so it is reported as one rather than allowed to become a NaN that
 * prints as "Invalid Date".
 */
export function sunTimes(at: Date, point: LatLng): SunTimes {
  const { eqtime, decl } = solarTerms(at);
  const lat = point.lat * RAD;

  const cosHourAngle =
    Math.cos((90 - HORIZON_DEG) * RAD) / (Math.cos(lat) * Math.cos(decl)) -
    Math.tan(lat) * Math.tan(decl);

  if (cosHourAngle < -1 || cosHourAngle > 1) {
    // Which side it fell off tells you which it is: the sun never sets when the
    // required hour angle is past a full half-turn.
    const alwaysUp = cosHourAngle < -1;
    return { sunrise: null, sunset: null, alwaysUp, alwaysDown: !alwaysUp };
  }

  const hourAngleDeg = Math.acos(cosHourAngle) * DEG;
  const midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const atMinutes = (minutes: number) => new Date(midnight + minutes * 60_000);

  return {
    sunrise: atMinutes(720 - 4 * (point.lng + hourAngleDeg) - eqtime),
    sunset: atMinutes(720 - 4 * (point.lng - hourAngleDeg) - eqtime),
    alwaysUp: false,
    alwaysDown: false,
  };
}

/**
 * The instant a plan for "today at `hour`:00" refers to.
 *
 * Built from a real `Date` so the viewer's timezone — including whatever its
 * daylight-saving rules are doing this week — is applied by the platform
 * rather than guessed at here.
 */
export function plannedAt(hour: number, now: Date = new Date()): Date {
  const when = new Date(now.getTime());
  when.setHours(Math.max(0, Math.min(23, Math.floor(hour))), 0, 0, 0);
  return when;
}

/** Minutes from `at` to the nearest edge of the night, for the wording. */
export function minutesAfterSunset(at: Date, point: LatLng): number | null {
  const { sunset } = sunTimes(at, point);
  if (!sunset) return null;
  return Math.round((at.getTime() - sunset.getTime()) / 60_000);
}

/** How many whole minutes of daylight are left, or null once the sun is down. */
export function minutesUntilSunset(at: Date, point: LatLng): number | null {
  const { sunset } = sunTimes(at, point);
  if (!sunset) return null;
  const left = Math.round((sunset.getTime() - at.getTime()) / 60_000);
  return left >= 0 ? left : null;
}

/** Exported for the tests: a day is this many minutes, and nothing else. */
export const DAY_MINUTES = MINUTES_PER_DAY;
