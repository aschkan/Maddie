/**
 * Open-Meteo — keyless. Weather matters here for one reason: rain and early
 * dark change who else is on the street, and "how overlooked is this walk" is
 * most of what makes it safe.
 *
 * Timezone comes from the bundled tz-lookup table: no key, no request, no
 * failure mode, and the answer does not change.
 */
import { z } from "zod";
import tzlookup from "tz-lookup";
import { getConfig } from "../config.ts";
import { upstreamJson } from "../http/fetch.ts";
import { absent, gapNote, present, type Signal } from "../signal.ts";
import type { LatLng } from "../geo/wkt.ts";

const Forecast = z
  .object({
    current: z
      .object({
        temperature_2m: z.number().optional(),
        precipitation: z.number().optional(),
        weather_code: z.number().optional(),
        wind_speed_10m: z.number().optional(),
        is_day: z.number().optional(),
      })
      .loose()
      .optional(),
    daily: z
      .object({
        sunrise: z.array(z.string()).default([]),
        sunset: z.array(z.string()).default([]),
      })
      .loose()
      .optional(),
  })
  .loose();

export interface WeatherNow {
  temperatureC: number | null;
  precipitationMm: number | null;
  windSpeedKph: number | null;
  isDay: boolean | null;
  sunrise: string | null;
  sunset: string | null;
  timezone: string;
}

export function timezoneFor(point: LatLng): string {
  try {
    return tzlookup(point.lat, point.lng);
  } catch {
    return "UTC";
  }
}

export function parseForecast(raw: unknown, timezone: string): WeatherNow | null {
  const parsed = Forecast.safeParse(raw);
  if (!parsed.success) return null;
  const current = parsed.data.current;
  const daily = parsed.data.daily;
  return {
    temperatureC: current?.temperature_2m ?? null,
    precipitationMm: current?.precipitation ?? null,
    windSpeedKph: current?.wind_speed_10m ?? null,
    isDay: current?.is_day === undefined ? null : current.is_day === 1,
    sunrise: daily?.sunrise[0] ?? null,
    sunset: daily?.sunset[0] ?? null,
    timezone,
  };
}

export async function fetchWeather(point: LatLng): Promise<Signal<WeatherNow>> {
  const config = getConfig();
  const source = "Open-Meteo";
  const timezone = timezoneFor(point);
  if (!config.weatherEnabled) {
    return absent("not-configured", source, gapNote("The weather feed", "not-configured"));
  }
  const url = new URL(config.weatherUrl);
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("longitude", String(point.lng));
  url.searchParams.set("current", "temperature_2m,precipitation,weather_code,wind_speed_10m,is_day");
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("timezone", timezone);
  url.searchParams.set("forecast_days", "1");

  try {
    const weather = parseForecast(await upstreamJson(url.toString()), timezone);
    if (weather === null) return absent("unreachable", source, gapNote("The weather feed", "unreachable"));
    return present(weather, source, 0.7);
  } catch {
    return absent("unreachable", source, gapNote("The weather feed", "unreachable"));
  }
}
