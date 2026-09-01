/**
 * Sunrise and sunset, computed offline.
 *
 * "Is it dark" is the single biggest driver of every score here — the same
 * street can be 78 at 3pm and 34 at 1am — so it must not depend on a network
 * call. This is the standard NOAA sunrise equation; it is accurate to about a
 * minute, which is far inside what any of this is sensitive to.
 */
import type { LatLng } from "../geo/wkt.ts";

const RAD = Math.PI / 180;
const J2000 = 2451545;

function toJulian(date: Date): number {
  return date.getTime() / 86_400_000 + 2440587.5;
}

function fromJulian(julian: number): Date {
  return new Date((julian - 2440587.5) * 86_400_000);
}

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  /** True when the sun never rises or never sets that day. */
  polar: boolean;
}

export function sunTimes(at: Date, point: LatLng): SunTimes {
  const n = Math.round(toJulian(at) - J2000 - 0.0009 + point.lng / 360);
  const jStar = J2000 + 0.0009 - point.lng / 360 + n;
  const m = (357.5291 + 0.98560028 * (jStar - J2000)) % 360;
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const jTransit = jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDelta = Math.sin(lambda * RAD) * Math.sin(23.44 * RAD);
  const cosDelta = Math.cos(Math.asin(sinDelta));
  const cosOmega =
    (Math.sin(-0.833 * RAD) - Math.sin(point.lat * RAD) * sinDelta) / (Math.cos(point.lat * RAD) * cosDelta);

  if (cosOmega > 1 || cosOmega < -1) return { sunrise: null, sunset: null, polar: true };
  const omega = Math.acos(cosOmega) / RAD;
  return {
    sunrise: fromJulian(jTransit - omega / 360),
    sunset: fromJulian(jTransit + omega / 360),
    polar: false,
  };
}

/**
 * 0 in broad daylight, 1 in full dark, ramping across the hour either side of
 * sunrise and sunset — the hour when a street changes character fastest.
 */
export function darkness(at: Date, point: LatLng): number {
  const times = sunTimes(at, point);
  if (times.polar || times.sunrise === null || times.sunset === null) {
    // Above the circles, fall back to the crude clock. Never in NL, but the
    // function must not return a confident wrong answer anywhere.
    const hour = at.getUTCHours();
    return hour >= 21 || hour < 6 ? 1 : 0;
  }

  const hour = 60 * 60 * 1000;
  const now = at.getTime();
  const sunrise = times.sunrise.getTime();
  const sunset = times.sunset.getTime();

  if (now >= sunrise + hour && now <= sunset - hour) return 0;
  if (now <= sunrise - hour || now >= sunset + hour) return 1;
  if (now < sunrise + hour) return Math.min(1, Math.max(0, (sunrise + hour - now) / (2 * hour)));
  return Math.min(1, Math.max(0, (now - (sunset - hour)) / (2 * hour)));
}

/** Local wall-clock hour at a point, from an IANA timezone. */
export function localHour(at: Date, timezone: string): number {
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(at);
    const hour = Number(formatted);
    return Number.isFinite(hour) ? hour % 24 : at.getUTCHours();
  } catch {
    return at.getUTCHours();
  }
}
