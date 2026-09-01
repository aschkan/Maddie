import { getConfig } from "@/lib/config";
import { json } from "@/lib/api";
import { proxyStatus } from "@/lib/http/fetch";
import { aiHealth } from "@/lib/ai/client";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * What this deployment can actually see. Every entry says whether a capability
 * is present, absent, or unknown — never "fine" by default.
 */
export async function GET(): Promise<Response> {
  const config = getConfig();
  const ai = config.aiEnabled ? await aiHealth() : [];

  return json({
    ok: true,
    region: config.region,
    appUrl: config.appUrl === "" ? null : config.appUrl,
    capabilities: {
      geocoding: { provider: config.geocodingProvider, keyless: true },
      crime: {
        enabled: config.crimeEnabled,
        table: config.crimeTable,
        windowMonths: config.crimeWindowMonths,
        note:
          config.region === "NL"
            ? null
            : "This deployment is not pointed at the Netherlands, so no recorded-crime source can answer.",
      },
      osm: { enabled: config.osmEnabled, endpoints: config.overpassEndpoints.length, concurrency: config.overpassMaxConcurrent },
      basemap: { servedByApp: config.mapStyleUrl.startsWith("/api/map") },
      reviews: {
        available: config.googleMapsKey !== "",
        note:
          config.googleMapsKey === ""
            ? "No Google Places key: nothing is known about how venues treat women on their own. That is a gap in the data."
            : null,
      },
      imagery: {
        available: config.mapillaryToken !== "" || config.googleMapsKey !== "",
        note:
          config.mapillaryToken === "" && config.googleMapsKey === ""
            ? "No street-imagery key: lighting and sightlines are not looked at visually. That is a gap in the data."
            : null,
      },
      admin: { enabled: config.adminToken !== "" },
      storage: getStore().backend,
      anonSalt: config.anonHashSalt === "" ? "UNSET — reporter hashes are guessable until this is set" : "set",
    },
    proxy: proxyStatus(),
    ai,
  });
}
