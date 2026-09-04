/**
 * Turning a typed address into a point, via Nominatim.
 *
 * Nominatim is OpenStreetMap's own search service and needs no key. It is run
 * on donated hardware with a published limit of one request per second, so the
 * caller here debounces and sends one request at a time — see `useGeocoder`.
 * Bursting past that limit gets an IP blocked, not throttled.
 */

import type { LatLng } from "./osrm.ts";

/**
 * Nominatim, or this server standing in front of it.
 *
 * Set `NEXT_PUBLIC_NOMINATIM_URL=/api/osm/nominatim` and the search goes out
 * through the server instead of from the browser — which is the only thing
 * that works on a network the browser cannot get out of. See
 * `src/app/api/osm/[service]/[...path]/route.ts`.
 */
export const DEFAULT_NOMINATIM =
  process.env.NEXT_PUBLIC_NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";

export interface Place {
  label: string;
  point: LatLng;
}

interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
}

/**
 * Nominatim returns lat and lon as STRINGS, which is the trap here: a stray
 * `Number()` on an empty string is 0, and 0,0 is a real coordinate in the Gulf
 * of Guinea rather than an obvious failure. Anything unparseable is dropped.
 */
export function parsePlaces(reply: unknown): Place[] {
  if (!Array.isArray(reply)) return [];
  const places: Place[] = [];
  for (const raw of reply as NominatimHit[]) {
    const lat = Number.parseFloat(raw?.lat ?? "");
    const lng = Number.parseFloat(raw?.lon ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    places.push({ label: raw.display_name ?? `${lat}, ${lng}`, point: { lat, lng } });
  }
  return places;
}

export interface SearchOutcome {
  places: Place[];
  /** Set when the search could not be run. Not the same as finding nothing. */
  error?: string;
}

/**
 * Search for a place by name. Never throws.
 *
 * Returns an outcome rather than a bare list, because "the search timed out"
 * and "there is no such street" are different answers that were previously
 * both an empty array — so a blocked or slow Nominatim looked exactly like a
 * typo, and you would sit there retyping an address that was fine.
 */
export async function searchPlaces(
  query: string,
  options: { base?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<SearchOutcome> {
  const text = query.trim();
  if (text.length < 3) return { places: [] };

  const params = new URLSearchParams({
    q: text,
    format: "jsonv2",
    limit: String(options.limit ?? 5),
    addressdetails: "0",
  });
  const base = (options.base ?? DEFAULT_NOMINATIM).replace(/\/+$/, "");

  try {
    const response = await fetch(`${base}/search?${params}`, {
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status === 429) {
      return { places: [], error: "Address search is rate limited just now — type more slowly, or click the map." };
    }
    if (!response.ok) {
      return { places: [], error: `Address search answered ${response.status}.` };
    }
    return { places: parsePlaces(await response.json()) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { places: [] };   // we replaced the request; not a failure
    }
    return { places: [], error: "Address search could not be reached. Click the map to set a point instead." };
  }
}
