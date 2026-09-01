/**
 * OpenStreetMap data, via Overpass.
 *
 * The single biggest lesson from the previous build: the public mirrors return
 * 429, 502, 504 and twenty-second timeouts continuously, and no amount of
 * client-side backoff turns a dead mirror into map data. Self-host it (see
 * docker-compose.yml); the app is NL-only, so a Netherlands extract is all it
 * ever needs.
 *
 * Everything below is what makes the public mirrors survivable when you must
 * use them:
 *   - concurrency 1, PROCESS-WIDE. Overpass hands out a couple of query slots
 *     per IP; what earns a 429 is several requests AT ONCE, and a tile grid
 *     sent with Promise.all is exactly that;
 *   - per-mirror cooldowns, with a TIMEOUT resting longest;
 *   - the cooldown is re-checked AFTER acquiring the slot, because most of the
 *     wait happens behind other tiles;
 *   - ONE deadline for the whole batch. Three mirrors × 20 s × several tiles
 *     exceeds any browser's patience, and the user just sees a dead page.
 */
import { z } from "zod";
import { getConfig } from "../config.ts";
import { cooldownFor, cooldownRemaining, gate, parseRetryAfter, rest } from "../http/limiter.ts";
import { upstreamFetch, UpstreamTimeoutError, UpstreamTransportError } from "../http/fetch.ts";
import { logger } from "../log.ts";
import type { LatLng } from "../geo/wkt.ts";

const log = logger("overpass");

const Element = z
  .object({
    type: z.string(),
    id: z.union([z.number(), z.string()]),
    lat: z.number().optional(),
    lon: z.number().optional(),
    center: z.object({ lat: z.number(), lon: z.number() }).optional(),
    tags: z.record(z.string(), z.string()).optional(),
    nodes: z.array(z.number()).optional(),
  })
  .loose();

const OverpassResponse = z.object({ elements: z.array(Element).default([]) }).loose();

export interface OsmFeature {
  id: string;
  kind: string;
  point: LatLng | null;
  tags: Record<string, string>;
}

export function parseOverpass(raw: unknown): OsmFeature[] {
  const parsed = OverpassResponse.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.elements.map((element) => {
    const centre =
      element.lat !== undefined && element.lon !== undefined
        ? { lat: element.lat, lng: element.lon }
        : element.center
          ? { lat: element.center.lat, lng: element.center.lon }
          : null;
    return {
      id: `${element.type}/${element.id}`,
      kind: element.type,
      point: centre,
      tags: element.tags ?? {},
    };
  });
}

export type TileOutcome =
  | { ok: true; features: OsmFeature[]; endpoint: string }
  | { ok: false; reason: "cooling" | "deadline" | "unreachable" | "error"; note: string };

function overpassGate() {
  const config = getConfig();
  return gate("overpass", {
    maxConcurrent: config.overpassMaxConcurrent,
    minIntervalMs: config.overpassMinIntervalMs,
  });
}

async function tryEndpoint(endpoint: string, ql: string, timeoutMs: number): Promise<TileOutcome> {
  try {
    const response = await upstreamFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: ql }).toString(),
      timeoutMs,
    });

    if (response.status === 429) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      rest(`overpass:${endpoint}`, cooldownFor("rate-limit", retryAfter));
      return { ok: false, reason: "error", note: `${endpoint} rate-limited` };
    }
    if (response.status >= 500) {
      rest(`overpass:${endpoint}`, cooldownFor("server-error"));
      return { ok: false, reason: "error", note: `${endpoint} answered ${response.status}` };
    }
    if (!response.ok) {
      return { ok: false, reason: "error", note: `${endpoint} answered ${response.status}` };
    }
    return { ok: true, features: parseOverpass(JSON.parse(response.text)), endpoint };
  } catch (error) {
    // A timeout and a rate limit are different failures, and only one of them
    // ever arrives as an HTTP status. If the failure callback fires on status
    // alone, a hung mirror stays in rotation forever.
    if (error instanceof UpstreamTimeoutError) {
      rest(`overpass:${endpoint}`, cooldownFor("timeout"));
      return { ok: false, reason: "unreachable", note: `${endpoint} timed out` };
    }
    if (error instanceof UpstreamTransportError) {
      rest(`overpass:${endpoint}`, cooldownFor("server-error"));
      return { ok: false, reason: "unreachable", note: `${endpoint} could not be reached` };
    }
    return { ok: false, reason: "error", note: error instanceof Error ? error.message : String(error) };
  }
}

/** One Overpass QL query, through the process-wide gate. */
export async function overpassQuery(ql: string, deadlineAt: number): Promise<TileOutcome> {
  const config = getConfig();
  if (!config.osmEnabled) {
    return { ok: false, reason: "error", note: "OpenStreetMap lookups are switched off on this deployment." };
  }

  return overpassGate().run(async () => {
    // Re-checked HERE, after the slot was acquired — not before queuing. Most
    // of the wait is behind other tiles, and a mirror that was cooling when
    // this was queued is very often free by now (and vice versa).
    for (const endpoint of config.overpassEndpoints) {
      if (Date.now() > deadlineAt) {
        return { ok: false, reason: "deadline", note: "The map-data deadline passed before this area was queried." };
      }
      const cooling = cooldownRemaining(`overpass:${endpoint}`);
      if (cooling > 0) {
        log.debug(`skipping ${endpoint}, resting for another ${Math.round(cooling / 1000)}s`);
        continue;
      }
      const remaining = deadlineAt - Date.now();
      const outcome = await tryEndpoint(endpoint, ql, Math.min(config.overpassTimeoutMs, Math.max(1_000, remaining)));
      if (outcome.ok) return outcome;
    }
    return {
      ok: false,
      reason: "cooling",
      note: "Every Overpass endpoint was unreachable or resting, so no map data was fetched. That is a gap in the data, not a statement about the place.",
    };
  });
}

export interface BatchResult {
  features: OsmFeature[];
  attempted: number;
  succeeded: number;
  failed: number;
  notes: string[];
}

/**
 * A batch of queries under ONE deadline. Past it the remaining queries are
 * reported FAILED, not attempted — which is the honest answer, and the only
 * one that arrives before the page gives up.
 */
export async function overpassBatch(queries: readonly string[], deadlineMs?: number): Promise<BatchResult> {
  const config = getConfig();
  const deadlineAt = Date.now() + (deadlineMs ?? config.overpassDeadlineMs);
  const features: OsmFeature[] = [];
  const notes: string[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const ql of queries) {
    if (Date.now() > deadlineAt) {
      failed += 1;
      notes.push("The map-data deadline passed before every area was queried.");
      continue;
    }
    const outcome = await overpassQuery(ql, deadlineAt);
    if (outcome.ok) {
      succeeded += 1;
      features.push(...outcome.features);
    } else {
      failed += 1;
      notes.push(outcome.note);
    }
  }

  return { features, attempted: queries.length, succeeded, failed, notes: [...new Set(notes)] };
}

export interface BBoxLike {
  south: number;
  west: number;
  north: number;
  east: number;
}

const bbox = (box: BBoxLike): string => `${box.south},${box.west},${box.north},${box.east}`;

/** Everything the scoring layer reads out of OSM, in one query per area. */
export function areaQuery(box: BBoxLike, timeoutSeconds = 25): string {
  return `[out:json][timeout:${timeoutSeconds}];
(
  node["highway"="street_lamp"](${bbox(box)});
  way["highway"~"^(primary|secondary|tertiary|residential|living_street|pedestrian|footway|path|service|unclassified)$"](${bbox(box)});
  node["amenity"](${bbox(box)});
  way["amenity"](${bbox(box)});
  node["shop"](${bbox(box)});
  way["shop"](${bbox(box)});
  node["public_transport"="stop_position"](${bbox(box)});
  node["highway"="bus_stop"](${bbox(box)});
  node["railway"~"^(station|tram_stop|halt)$"](${bbox(box)});
  node["emergency"~"^(phone|assembly_point)$"](${bbox(box)});
  way["building"](${bbox(box)});
  way["landuse"~"^(industrial|forest|farmland|brownfield)$"](${bbox(box)});
  way["leisure"="park"](${bbox(box)});
);
out center tags 400;`;
}

/** Venues only — the search surface, which does not need the street furniture. */
export function venueQuery(box: BBoxLike, filters: readonly string[], timeoutSeconds = 25): string {
  const clauses = filters
    .flatMap((filter) => [`node${filter}(${bbox(box)});`, `way${filter}(${bbox(box)});`])
    .join("\n  ");
  return `[out:json][timeout:${timeoutSeconds}];
(
  ${clauses}
);
out center tags 200;`;
}
