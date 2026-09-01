import { json, badRequest, numberParam } from "@/lib/api";
import { geocode, reverseGeocode } from "@/lib/sources/geocode";

export const dynamic = "force-dynamic";

/**
 * Text or a point in; addresses and CBS neighbourhood codes out.
 *
 * "No such address" is 200 with an empty list and a note. "We could not ask"
 * is 503 with a different note. They are opposite claims and a 404 for both
 * is how a woman ends up trusting a gap.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = url.searchParams.get("q");
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");

  if (lat !== null && lng !== null) {
    const point = { lat: numberParam(lat, NaN), lng: numberParam(lng, NaN) };
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      return badRequest("lat and lng must both be numbers.");
    }
    const outcome = await reverseGeocode(point);
    if (outcome.status === "unavailable") {
      return json({ status: outcome.status, places: [], note: outcome.note, provider: outcome.provider }, 503);
    }
    return json({
      status: outcome.status,
      provider: outcome.provider,
      places: outcome.status === "ok" ? outcome.places : [],
      note: outcome.status === "ok" ? null : outcome.note,
    });
  }

  if (query === null || query.trim() === "") {
    return badRequest("Pass either ?q= for a search, or ?lat= and ?lng= for a reverse lookup.");
  }

  const outcome = await geocode(query, numberParam(url.searchParams.get("limit"), 8));
  if (outcome.status === "unavailable") {
    return json({ status: outcome.status, places: [], note: outcome.note, provider: outcome.provider }, 503);
  }
  return json({
    status: outcome.status,
    provider: outcome.provider,
    places: outcome.status === "ok" ? outcome.places : [],
    note: outcome.status === "ok" ? null : outcome.note,
  });
}
