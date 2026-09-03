/**
 * Turning a typed address into a point, via Nominatim.
 *
 * Nominatim is OpenStreetMap's own search service and needs no key. It is run
 * on donated hardware with a published limit of one request per second, so the
 * caller here debounces and sends one request at a time — see `useGeocoder`.
 * Bursting past that limit gets an IP blocked, not throttled.
 */

import type { LatLng } from "./osrm.ts";

export const DEFAULT_NOMINATIM = "https://nominatim.openstreetmap.org";

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

/** Search for a place by name. Never throws; an empty list means "nothing". */
export async function searchPlaces(
  query: string,
  options: { base?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<Place[]> {
  const text = query.trim();
  if (text.length < 3) return [];

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
    if (!response.ok) return [];
    return parsePlaces(await response.json());
  } catch {
    return [];
  }
}
