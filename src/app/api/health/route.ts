import { getConfig } from "@/lib/config";
import { json } from "@/lib/api";
import { proxyStatus, upstreamBytes } from "@/lib/http/fetch";
import { aiHealth } from "@/lib/ai/client";
import { getStore } from "@/lib/store";
import {
  fillTileTemplate,
  firstTileTemplate,
  isTileTemplate,
  styleSources,
  tileForLatLng,
  zoomRange,
  zoomWithin,
  DEFAULT_TILE_UPSTREAM,
} from "@/lib/map/proxy";

interface ProbeStep {
  step: string;
  url: string;
  ok: boolean;
  status: number | null;
  detail: string | null;
}

/**
 * Actually FETCH the basemap, rather than reporting the config back.
 *
 * `basemap.servedByApp` says where the style is meant to come from. It has
 * never said whether anything arrives, and the two look identical from the
 * page: the background colour and the attribution live in the style document,
 * so a map whose every tile 404s still draws a tinted rectangle with a credit
 * in the corner. "It renders" is not evidence that it works.
 *
 * Three fetches, server-side, along the chain the browser walks: style →
 * source → one tile. Whichever one stops is the answer. Opt-in (?probe=basemap)
 * because a health check that always costs three upstream round trips is a
 * health check people stop calling.
 */
async function probeBasemap(upstream: string): Promise<ProbeStep[]> {
  const base = (upstream === "" ? DEFAULT_TILE_UPSTREAM : upstream).replace(/\/+$/, "");
  const steps: ProbeStep[] = [];

  const fetchStep = async (step: string, url: string): Promise<Uint8Array | null> => {
    try {
      const response = await upstreamBytes(url, { timeoutMs: 10_000 });
      steps.push({
        step,
        url,
        ok: response.ok,
        status: response.status,
        detail: response.ok ? `${response.bytes.byteLength} bytes via ${response.via}` : "the tile host refused this",
      });
      return response.ok ? response.bytes : null;
    } catch (error) {
      steps.push({ step, url, ok: false, status: null, detail: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };

  const parse = (bytes: Uint8Array | null): unknown => {
    if (bytes === null) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  };

  const style = parse(await fetchStep("style", `${base}/styles/liberty`));
  if (style === null) return steps;

  const sources = styleSources(style);
  if (sources.length === 0) {
    steps.push({ step: "sources", url: "", ok: false, status: null, detail: "the style names no source to fetch tiles from" });
    return steps;
  }

  for (const source of sources) {
    // A TileJSON URL is fetched and read; an inline template is already the
    // tile, and fetching it unfilled is what produced a bogus 404 before.
    let template = source.tileTemplate;
    let range = { minzoom: source.minzoom, maxzoom: source.maxzoom };
    if (source.url !== null && !isTileTemplate(source.url)) {
      const tilejson = parse(await fetchStep(`source:${source.id}`, source.url));
      if (tilejson === null) continue;
      template = firstTileTemplate(tilejson) ?? template;
      const declared = zoomRange(tilejson);
      range = { minzoom: declared.minzoom ?? range.minzoom, maxzoom: declared.maxzoom ?? range.maxzoom };
    }
    if (template === null) {
      steps.push({ step: `tile:${source.id}`, url: "", ok: false, status: null, detail: "this source lists no tile template" });
      continue;
    }
    // Amsterdam, at a zoom THIS source actually has tiles for. Asking a
    // low-zoom relief layer for z14 is a 404 that says nothing about the host.
    const { z, x, y } = tileForLatLng(52.3728, 4.8936, zoomWithin(14, range));
    await fetchStep(`tile:${source.id}`, fillTileTemplate(template, z, x, y));
  }
  return steps;
}

/**
 * What this deployment can actually see. Every entry says whether a capability
 * is present, absent, or unknown — never "fine" by default.
 */
export async function GET(request: Request): Promise<Response> {
  const config = getConfig();
  const ai = config.aiEnabled ? await aiHealth() : [];
  const wantsProbe = new URL(request.url).searchParams.get("probe") !== null;
  const basemapProbe = wantsProbe ? await probeBasemap(config.mapTilesUpstream) : null;

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
      basemap: {
        servedByApp: config.mapStyleUrl.startsWith("/api/map"),
        upstream: config.mapTilesUpstream === "" ? DEFAULT_TILE_UPSTREAM : config.mapTilesUpstream,
        // null = NOT MEASURED. Add ?probe=basemap to actually fetch it.
        reachable: basemapProbe === null ? null : basemapProbe.every((step) => step.ok),
        probe: basemapProbe,
      },
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
