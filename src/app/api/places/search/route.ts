import { json, numberParam, parseAt } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { searchPlaces } from "@/lib/scoring/places";

export const dynamic = "force-dynamic";

/**
 * Safety-ranked place search.
 *
 * An empty list is only ever reported alongside the coverage it was built
 * from: "the map loaded and there is nothing here" and "no map data arrived"
 * are opposite claims that look identical on a screen.
 */
export async function GET(request: Request): Promise<Response> {
  const config = getConfig();
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const centre = {
    lat: numberParam(url.searchParams.get("lat"), config.defaultCenter.lat),
    lng: numberParam(url.searchParams.get("lng"), config.defaultCenter.lng),
  };

  const result = await searchPlaces({
    query,
    centre,
    at: parseAt(url.searchParams.get("at")),
    radiusMetres: Math.min(3_000, Math.max(150, numberParam(url.searchParams.get("radiusMetres"), 900))),
    limit: Math.min(30, Math.max(1, numberParam(url.searchParams.get("limit"), 12))),
  });

  return json(result, result.coverage === "none" ? 503 : 200);
}
