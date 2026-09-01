/**
 * Nominatim — the fallback geocoder, used outside NL and when PDOK has no
 * record.
 *
 * Their usage policy is one request per second and it is enforced by BAN, not
 * by 429: the first sign of breaking it is that the server's IP stops being
 * answered at all. So the queue below is process-wide and genuinely
 * serialised, and it lives on `globalThis` because Next loads modules in
 * several graphs — a per-graph queue triples the rate while looking correct in
 * every file that owns one.
 */
import { z } from "zod";
import { getConfig } from "../config.ts";
import { gate } from "../http/limiter.ts";
import { upstreamJson, UpstreamTimeoutError, UpstreamTransportError } from "../http/fetch.ts";
import type { GeoPlace } from "./pdok.ts";
import type { LatLng } from "../geo/wkt.ts";

const NominatimPlace = z
  .object({
    place_id: z.union([z.number(), z.string()]).optional(),
    osm_id: z.union([z.number(), z.string()]).optional(),
    lat: z.union([z.string(), z.number()]),
    lon: z.union([z.string(), z.number()]),
    display_name: z.string().optional(),
    type: z.string().optional(),
    address: z
      .object({
        postcode: z.string().optional(),
        city: z.string().optional(),
        town: z.string().optional(),
        village: z.string().optional(),
        municipality: z.string().optional(),
        state: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export function parseNominatim(raw: unknown): GeoPlace[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const out: GeoPlace[] = [];
  for (const item of list) {
    const parsed = NominatimPlace.safeParse(item);
    if (!parsed.success) continue;
    const lat = Number(parsed.data.lat);
    const lng = Number(parsed.data.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const address = parsed.data.address ?? {};
    out.push({
      id: String(parsed.data.place_id ?? parsed.data.osm_id ?? `${lat},${lng}`),
      label: parsed.data.display_name ?? "",
      type: parsed.data.type ?? "unknown",
      point: { lat, lng },
      // Nominatim knows nothing about CBS neighbourhoods, which is exactly why
      // it is the fallback: a place geocoded here cannot be joined to the
      // crime figures at all, and the score has to say so.
      areas: [],
      municipality: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
      province: address.state ?? null,
      postcode: address.postcode ?? null,
      source: "nominatim",
    });
  }
  return out;
}

/** One at a time, one second apart, for the whole process. */
function queue() {
  return gate("nominatim", { maxConcurrent: 1, minIntervalMs: 1_100 });
}

export type NominatimOutcome =
  | { ok: true; places: GeoPlace[] }
  | { ok: false; reason: "unreachable" | "timeout" | "error"; detail: string };

async function call(path: string, params: Record<string, string>): Promise<NominatimOutcome> {
  const config = getConfig();
  const url = new URL(`${config.nominatimUrl}${path}`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  if (config.nominatimContactEmail !== "") url.searchParams.set("email", config.nominatimContactEmail);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    const body = await queue().run(() => upstreamJson(url.toString()));
    return { ok: true, places: parseNominatim(body) };
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) return { ok: false, reason: "timeout", detail: error.message };
    if (error instanceof UpstreamTransportError) return { ok: false, reason: "unreachable", detail: error.message };
    return { ok: false, reason: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function nominatimSearch(text: string, limit = 8): Promise<NominatimOutcome> {
  const config = getConfig();
  const params: Record<string, string> = { q: text, limit: String(limit) };
  if (config.geocodingCountry !== "") params.countrycodes = config.geocodingCountry;
  return call("/search", params);
}

export async function nominatimReverse(point: LatLng): Promise<NominatimOutcome> {
  return call("/reverse", { lat: String(point.lat), lon: String(point.lng), zoom: "18" });
}
