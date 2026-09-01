/**
 * Geocoding, with the failure modes kept apart.
 *
 * "There is no such address" and "the geocoder timed out" both arrive as an
 * empty result if you let them, and they are opposite claims: one says the
 * place does not exist, the other says we never found out.
 */
import { getConfig } from "../config.ts";
import type { LatLng } from "../geo/wkt.ts";
import { mostSpecificArea, pdokFree, pdokReverse, pdokSuggest, type GeoPlace } from "./pdok.ts";
import { nominatimReverse, nominatimSearch } from "./nominatim.ts";

export type GeocodeOutcome =
  | { status: "ok"; places: GeoPlace[]; provider: string }
  | { status: "empty"; provider: string; note: string }
  | { status: "unavailable"; provider: string; note: string };

const NOT_FOUND_NOTE =
  "Nothing matched that search. The geocoders answered — this is not a connection problem.";

function unavailableNote(provider: string, reason: string): string {
  return `The ${provider} geocoder ${reason === "timeout" ? "timed out" : "could not be reached"}, so nothing was looked up. This is not the same as finding no such address.`;
}

/** Text → places. PDOK first inside NL, because only it carries CBS codes. */
export async function geocode(text: string, limit = 8): Promise<GeocodeOutcome> {
  const config = getConfig();
  const query = text.trim();
  if (query === "") return { status: "empty", provider: "none", note: "Nothing was searched for." };

  const usePdok = config.geocodingProvider === "pdok" || config.geocodingProvider === "auto";
  let sawUnavailable: string | null = null;

  if (usePdok) {
    const free = await pdokFree(query, limit);
    if (free.ok && free.places.length > 0) return { status: "ok", places: free.places, provider: "pdok" };
    if (!free.ok) sawUnavailable = unavailableNote("PDOK", free.reason);
    else {
      const suggest = await pdokSuggest(query, limit);
      if (suggest.ok && suggest.places.length > 0) {
        return { status: "ok", places: suggest.places, provider: "pdok" };
      }
      if (!suggest.ok) sawUnavailable = unavailableNote("PDOK", suggest.reason);
    }
  }

  if (config.geocodingProvider !== "pdok") {
    const fallback = await nominatimSearch(query, limit);
    if (fallback.ok && fallback.places.length > 0) {
      return { status: "ok", places: fallback.places, provider: "nominatim" };
    }
    if (!fallback.ok) sawUnavailable = unavailableNote("Nominatim", fallback.reason);
  }

  if (sawUnavailable !== null) {
    return { status: "unavailable", provider: config.geocodingProvider, note: sawUnavailable };
  }
  return { status: "empty", provider: config.geocodingProvider, note: NOT_FOUND_NOTE };
}

/** Point → address, and — the part that matters — the CBS area codes. */
export async function reverseGeocode(point: LatLng): Promise<GeocodeOutcome> {
  const config = getConfig();
  let sawUnavailable: string | null = null;

  if (config.geocodingProvider !== "nominatim") {
    const reverse = await pdokReverse(point);
    if (reverse.ok && reverse.places.length > 0) {
      return { status: "ok", places: reverse.places, provider: "pdok" };
    }
    if (!reverse.ok) sawUnavailable = unavailableNote("PDOK", reverse.reason);
  }

  if (config.geocodingProvider !== "pdok") {
    const fallback = await nominatimReverse(point);
    if (fallback.ok && fallback.places.length > 0) {
      return { status: "ok", places: fallback.places, provider: "nominatim" };
    }
    if (!fallback.ok) sawUnavailable = unavailableNote("Nominatim", fallback.reason);
  }

  if (sawUnavailable !== null) {
    return { status: "unavailable", provider: config.geocodingProvider, note: sawUnavailable };
  }
  return {
    status: "empty",
    provider: config.geocodingProvider,
    note: "No address is registered at that point. The geocoders answered — this is not a connection problem.",
  };
}

/**
 * The CBS area a point sits in. Returns null with a reason rather than an
 * empty area, because "we could not tell which neighbourhood this is" and
 * "this neighbourhood has no crime" must not arrive looking the same.
 */
export async function areaForPoint(
  point: LatLng,
): Promise<{ place: GeoPlace | null; area: ReturnType<typeof mostSpecificArea>; note: string | null }> {
  const outcome = await reverseGeocode(point);
  if (outcome.status !== "ok") return { place: null, area: null, note: outcome.note };
  const place = outcome.places[0] ?? null;
  if (place === null) return { place: null, area: null, note: outcome.status };
  const area = mostSpecificArea(place);
  if (area === null) {
    return {
      place,
      area: null,
      note: "This address carries no CBS neighbourhood code, so the police figures cannot be looked up for it. That is a gap in the data, not a statement about the place.",
    };
  }
  return { place, area, note: null };
}
