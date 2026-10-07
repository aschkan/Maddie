/**
 * `npm run scenario` — record the interview scenario, once.
 *
 * Asks the same services the app asks live — OSRM for the ways round, Overpass
 * for what the map says along them and for the places and lighting nearby —
 * and writes the answers to `src/lib/scenario-recording.json`, which the app
 * then replays instead of asking. See the header of `src/lib/scenario.ts` for
 * why the scenario must not ask live: every participant has to see the same
 * streets.
 *
 * It goes out DIRECTLY, not through `/api/osm/*`: there is no server running
 * when this is used, and it is run by hand on a machine that can reach the
 * services. The routing host is `routing.openstreetmap.de`, whose foot and bike
 * profiles are maintained — the public `router.project-osrm.org` demo reliably
 * serves only driving (see `osrm.ts`).
 *
 * Re-recording changes what participants see. Do it BEFORE the first session
 * of a round, never between sessions, and commit the file it writes.
 *
 *   npm run scenario
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { distanceToPathM } from "../src/lib/geo.ts";
import { layerQuery, parseLayers, SAFE_SPOTS, type BBox, type LayerData, type LitWay, type Lamp, type Spot } from "../src/lib/layers.ts";
import { fetchRoutes, parseRoutes, type LatLng, type Profile, type Route } from "../src/lib/osrm.ts";
import { fetchFacts, type RouteFacts, type SampleRead } from "../src/lib/overpass.ts";
import { USER_AGENT } from "../src/lib/proxy-pool.ts";
import {
  legKey, SCENARIO_DESTINATIONS, SCENARIO_PROFILES, SCENARIO_START,
  type RecordedRoute, type ScenarioRecording,
} from "../src/lib/scenario.ts";

const ROUTING: Record<string, string> = {
  walking: "https://routing.openstreetmap.de/routed-foot",
  cycling: "https://routing.openstreetmap.de/routed-bike",
};
/** OSRM's own profile names on that host. `osrm.ts` keeps the same table. */
const OSRM_PROFILE: Record<string, string> = { walking: "foot", cycling: "bike" };

/** At most this many ways round per leg — the same cap the app applies live. */
const MAX_ROUTES = 3;
/**
 * Two routes this alike are one route. A via point on a street the direct
 * route already uses gives back the direct route, and offering it twice would
 * be a comparison with nothing in it.
 */
const SAME_ROUTE_M = 60;
/** A read that times out is asked again — Overpass is often merely busy. */
const READ_TRIES = 6;
/**
 * Overpass, directly by default. `--via-server` asks the deployed app's own
 * forwarder instead, which rotates through its pool of exits — for the day
 * overpass-api.de has stopped answering this machine, which it does after a
 * few dozen queries in a row. A command-line flag, not an environment variable:
 * it is a choice about one run of one script.
 */
const OVERPASS = process.argv.includes("--via-server")
  ? "https://maddie.arsaces.ir/api/osm/overpass"
  : "https://overpass-api.de/api/interpreter";

/** How far from any route a place or lamp is still worth keeping. */
const CORRIDOR_M = 350;
/** The layer query is asked cell by cell; one query over the whole area is capped. */
const CELL_DEG = 0.01;
/**
 * The gap between queries. Overpass hands out two slots per IP, and going
 * DIRECT it also blocks an IP outright, for many minutes, after a burst — a
 * 1.5 s pace got a few answers and then a lockout every time. Fifteen seconds
 * is slow and finishes; through the forwarder each query leaves by its own exit.
 */
const PAUSE_MS = process.argv.includes("--via-server") ? 1_500 : 15_000;

const OUT = fileURLToPath(new URL("../src/lib/scenario-recording.json", import.meta.url));

/**
 * Everything already fetched, kept between runs.
 *
 * Overpass rate-limits, times out and sometimes refuses outright, and a full
 * recording is a few dozen queries — so a run that dies on the last one used
 * to throw away all the others. Each answer is written here the moment it
 * arrives and reused by the next run; delete the file to record from scratch.
 * Under `.data/`, which is gitignored: it is a working cache, not the record.
 */
const CACHE = fileURLToPath(new URL("../.data/scenario-cache.json", import.meta.url));
const cache: Record<string, unknown> = existsSync(CACHE)
  ? (JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, unknown>)
  : {};

function remember<T>(key: string, value: T): T {
  cache[key] = value;
  mkdirSync(fileURLToPath(new URL("../.data/", import.meta.url)), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache));
  return value;
}

/**
 * A rate limit means "wait about a minute" — waiting less just holds it open.
 * Through the forwarder it is not this machine's IP being limited: every retry
 * leaves by a different exit, so a short pause is enough.
 */
const RATE_LIMIT_REST_MS = process.argv.includes("--via-server") ? 8_000 : 120_000;

/*
 * The app's own User-Agent, on every request this script makes.
 *
 * The library fetchers are written for the browser, which sends one of its
 * own; Node sends `node`, and overpass-api.de answers that with a 406 — which
 * `fetchFacts` reports as "OpenStreetMap's query service answered 406", a
 * sentence about the service rather than about this script. The server's
 * forwarder already identifies itself with the same constant.
 */
const plainFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  /*
   * Through the forwarder, every query gets a fresh comment on the end. The
   * forwarder caches a 200 for ten minutes by query text, so a refused empty
   * answer (below) would otherwise come back from its cache on every retry.
   * An Overpass QL comment changes the text and nothing about the question.
   */
  if (process.argv.includes("--via-server") && typeof init.body === "string" && init.body.startsWith("data=")) {
    init = { ...init, body: `${init.body}${encodeURIComponent(`\n/* ${Date.now()}-${Math.random()} */`)}` };
  }
  const response = await plainFetch(input, { ...init, headers });

  /*
   * An EMPTY Overpass answer is refused, and turned into a 502 so the reader
   * retries it.
   *
   * Every query this script makes covers central Utrecht, where there is no
   * 300 m of street without a mapped way. So a reply with no elements is not
   * "nothing here" — it is a regional mirror answering for somewhere it does
   * not hold (overpass.osm.ch, Switzerland only, did exactly this through the
   * live forwarder), or a server cutting a query short. Recorded, it would
   * replay in every session as "nobody has mapped these streets", which is
   * false. Better to fail the run than to record that.
   */
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  // Only a ROUTE read can never be empty — it asks for the ways `around:` a
  // line through central Utrecht. A layer query over a 250 m square can
  // truthfully come back with no places in it, and refusing that answer made
  // the recorder retry a correct reply eighteen times and then give up.
  const body = typeof init.body === "string" ? decodeURIComponent(init.body) : "";
  if (/interpreter|osm\/overpass/.test(url) && response.ok && body.includes("around:")) {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { elements?: unknown[] };
      if (Array.isArray(body.elements) && body.elements.length === 0) {
        return new Response("empty reply refused", { status: 502 });
      }
    } catch {
      // Not JSON: hand it on unchanged and let the reader say so.
    }
    // Rebuilt with only what a reader needs. The upstream's own headers —
    // `transfer-encoding: chunked`, `content-encoding` — describe bytes that
    // have already been read and decoded, and carried onto a buffered body they
    // make the reply unreadable. `x-osm-exits` is kept: it sizes the split.
    const kept = new Headers({ "Content-Type": "application/json" });
    const exits = response.headers.get("x-osm-exits");
    if (exits) kept.set("x-osm-exits", exits);
    return new Response(text, { status: response.status, headers: kept });
  }
  return response;
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const round5 = (value: number) => Number(value.toFixed(5));
const roundPoint = (point: LatLng): LatLng => ({ lat: round5(point.lat), lng: round5(point.lng) });

/** Five decimals is a metre. Anything finer is bytes nobody can see. */
function trimRead(read: SampleRead): SampleRead {
  return { ...read, point: roundPoint(read.point), alongM: Math.round(read.alongM) };
}

/** One route, forced through a point. OSRM takes the coordinates lon,lat. */
async function viaRoute(from: LatLng, via: LatLng, to: LatLng, profile: Profile): Promise<Route | null> {
  const base = ROUTING[profile];
  const osrm = OSRM_PROFILE[profile];
  if (!base || !osrm) return null;
  const coords = [from, via, to].map((p) => `${p.lng},${p.lat}`).join(";");
  const response = await fetch(`${base}/route/v1/${osrm}/${coords}?overview=full&geometries=geojson`);
  if (!response.ok) throw new Error(`via route answered ${response.status}`);
  const parsed = parseRoutes(await response.json());
  return parsed.ok ? (parsed.routes[0] ?? null) : null;
}

/** Whether two routes are the same line, sampled at quarters along each. */
function sameRoute(a: Route, b: Route): boolean {
  if (Math.abs(a.metres - b.metres) > Math.max(a.metres, b.metres) * 0.04) return false;
  return [0.25, 0.5, 0.75].every((share) => {
    const pa = a.path[Math.floor(a.path.length * share)];
    return pa !== undefined && distanceToPathM(pa, b.path) < SAME_ROUTE_M;
  });
}

async function readWithRetry(path: LatLng[], label: string) {
  const key = `read|${path.length}|${path[0]?.lat},${path[0]?.lng}|${path[path.length - 1]?.lat},${path[path.length - 1]?.lng}`;
  const held = cache[key] as { ok: true; facts: RouteFacts; reads: SampleRead[] } | undefined;
  if (held) return held;
  for (let attempt = 1; attempt <= READ_TRIES; attempt++) {
    const read = await fetchFacts(path, { base: OVERPASS });
    if (read.ok) return remember(key, read);
    console.warn(`  ! ${label}, attempt ${attempt}: ${read.error}`);
    await pause(/rate limit|could not reach/i.test(read.error) ? RATE_LIMIT_REST_MS : PAUSE_MS * 6 * attempt);
  }
  // A route that cannot be read is NOT recorded with empty facts: it would
  // replay forever as "nobody has mapped this", a claim about the map that
  // would be false. Fail the run instead.
  throw new Error(`${label}: Overpass would not answer after ${READ_TRIES} tries`);
}

async function recordLegs(): Promise<Record<string, RecordedRoute[]>> {
  const legs: Record<string, RecordedRoute[]> = {};
  for (const destination of SCENARIO_DESTINATIONS) {
    for (const profile of SCENARIO_PROFILES) {
      const base = ROUTING[profile];
      if (!base) continue;
      const routesKey = `routes|${destination.id}|${profile}`;
      const found = (cache[routesKey] as { ok: true; routes: Route[] } | undefined)
        ?? await fetchRoutes(SCENARIO_START.point, destination.point, profile, { base });
      if (!found.ok) throw new Error(`${destination.id} ${profile}: ${found.error}`);
      remember(routesKey, found);

      // OSRM's own offer first — its first route is the quickest, and the
      // app's "Fastest" tag must point at a real fastest route — then the
      // forced ones, skipping any that turn out to be a route already held.
      const candidates: Route[] = [...found.routes];
      for (const via of destination.via ?? []) {
        const viaKey = `via|${destination.id}|${profile}|${via.lat},${via.lng}`;
        let route = cache[viaKey] as Route | null | undefined;
        if (route === undefined) {
          await pause(PAUSE_MS);
          route = remember(viaKey, await viaRoute(SCENARIO_START.point, via, destination.point, profile));
        }
        if (route) candidates.push(route);
      }
      const chosen: Route[] = [];
      for (const route of candidates) {
        if (chosen.length >= MAX_ROUTES) break;
        if (!chosen.some((held) => sameRoute(held, route))) chosen.push(route);
      }

      const recorded: RecordedRoute[] = [];
      for (const [index, route] of chosen.entries()) {
        await pause(PAUSE_MS);
        const label = `${destination.id} · ${profile} · route ${index + 1}`;
        const read = await readWithRetry(route.path, label);
        recorded.push({
          path: route.path.map(roundPoint),
          metres: Math.round(route.metres),
          seconds: Math.round(route.seconds),
          facts: read.facts,
          reads: read.reads.map(trimRead),
        });
        console.log(`  ${label}: ${(route.metres / 1000).toFixed(2)} km, ${read.reads.length} points`);
      }
      legs[legKey(destination.id, profile)] = recorded;
    }
  }
  return legs;
}

function near(point: LatLng, paths: LatLng[][]): boolean {
  return paths.some((path) => distanceToPathM(point, path) <= CORRIDOR_M);
}

type LayerReply = { ok: true; data: LayerData } | { ok: false; error: string };

/**
 * One layer query, with a timeout the recorder can afford.
 *
 * `fetchLayers` asks Overpass for 25 seconds, which is right for a page a
 * person is waiting on and wrong here: a busy Overpass answers "timed out" to
 * a short allowance on any query, however small — a 250 m square of central
 * Utrecht did, three times running. A script can wait ninety seconds.
 */
async function askLayers(cell: BBox, kinds: string[], lighting: boolean): Promise<LayerReply> {
  const query = layerQuery(cell, kinds, lighting, 90);
  if (!query) return { ok: true, data: { spots: [], lamps: [], litWays: [], truncated: false } };
  try {
    const response = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (response.status === 429) return { ok: false, error: "rate limit" };
    if (response.status === 504) return { ok: false, error: "timed out" };
    if (!response.ok) return { ok: false, error: `Overpass answered ${response.status}` };
    return { ok: true, data: parseLayers(await response.json()) };
  } catch {
    return { ok: false, error: "could not reach Overpass" };
  }
}

/**
 * The layers for one cell: the places and the lighting as TWO queries.
 *
 * Asked together, a city-centre cell is hundreds of lit streets with full
 * geometry plus every kind of place, in one reply. Apart, each is light — and a
 * cell where only one of them fails costs one retry, not both.
 */
async function layersFor(
  cell: BBox, kinds: string[], depth = 0, only: "places" | "lighting" | null = null,
): Promise<LayerReply> {
  // A whole cell keeps the key earlier runs saved it under; a quarter, or one
  // half of a cell, gets its own.
  const cellKey = depth === 0 && only === null
    ? `cell2|${cell.south.toFixed(4)},${cell.west.toFixed(4)}`
    : `cell2|${cell.south.toFixed(4)},${cell.west.toFixed(4)}|${cell.north.toFixed(4)}|${only ?? "both"}`;
  const held = cache[cellKey] as LayerReply | undefined;
  if (held) return held;

  const parts: LayerData[] = [];
  const halves = ([["places", kinds, false], ["lighting", [], true]] as const)
    .filter(([label]) => only === null || only === label);
  for (const [label, wantKinds, lighting] of halves) {
    let found = await askLayers(cell, [...wantKinds], lighting);
    for (let attempt = 2; !found.ok && attempt <= READ_TRIES; attempt++) {
      console.warn(`  ! cell ${cell.south.toFixed(3)},${cell.west.toFixed(3)} ${label}, attempt ${attempt - 1}: ${found.error}`);
      await pause(/rate limit|could not reach/i.test(found.error) ? RATE_LIMIT_REST_MS : PAUSE_MS * 2 * attempt);
      found = await askLayers(cell, [...wantKinds], lighting);
    }
    await pause(PAUSE_MS);
    if (!found.ok && /timed out|answered 50[234]/i.test(found.error) && depth < 2) {
      // The same question keeps timing out: ask a quarter of it, four times.
      console.warn(`  ! cell ${cell.south.toFixed(4)},${cell.west.toFixed(4)} ${label} keeps timing out — asking for its quarters`);
      const midLat = (cell.south + cell.north) / 2;
      const midLng = (cell.west + cell.east) / 2;
      const quarters: BBox[] = [
        { south: cell.south, west: cell.west, north: midLat, east: midLng },
        { south: cell.south, west: midLng, north: midLat, east: cell.east },
        { south: midLat, west: cell.west, north: cell.north, east: midLng },
        { south: midLat, west: midLng, north: cell.north, east: cell.east },
      ];
      const pieces: LayerData[] = [];
      for (const quarter of quarters) {
        const piece = await layersFor(quarter, lighting ? [] : [...wantKinds], depth + 1, lighting ? "lighting" : "places");
        if (!piece.ok) return piece;
        pieces.push(piece.data);
      }
      found = {
        ok: true,
        data: {
          spots: pieces.flatMap((piece) => piece.spots),
          lamps: pieces.flatMap((piece) => piece.lamps),
          litWays: pieces.flatMap((piece) => piece.litWays),
          truncated: pieces.some((piece) => piece.truncated),
        },
      };
    }
    if (!found.ok) return found;
    parts.push(found.data);
  }
  const merged: LayerReply = {
    ok: true,
    data: {
      spots: parts.flatMap((part) => part.spots),
      lamps: parts.flatMap((part) => part.lamps),
      litWays: parts.flatMap((part) => part.litWays),
      truncated: parts.some((part) => part.truncated),
    },
  };
  return remember(cellKey, merged);
}

async function recordLayers(paths: LatLng[][]): Promise<LayerData> {
  const all = paths.flat();
  const south = Math.min(...all.map((p) => p.lat)) - 0.004;
  const north = Math.max(...all.map((p) => p.lat)) + 0.004;
  const west = Math.min(...all.map((p) => p.lng)) - 0.006;
  const east = Math.max(...all.map((p) => p.lng)) + 0.006;

  const spots = new Map<string, Spot>();
  const lamps = new Map<string, Lamp>();
  const litWays = new Map<string, LitWay>();
  const kinds = SAFE_SPOTS.map((kind) => kind.id);

  for (let lat = south; lat < north; lat += CELL_DEG) {
    for (let lng = west; lng < east; lng += CELL_DEG) {
      const cell = { south: lat, west: lng, north: Math.min(north, lat + CELL_DEG), east: Math.min(east, lng + CELL_DEG) };
      // Only cells the routes actually pass near. The bounding box of three
      // diverging routes is mostly streets none of them use.
      const middle = { lat: (cell.south + cell.north) / 2, lng: (cell.west + cell.east) / 2 };
      if (!paths.some((path) => distanceToPathM(middle, path) <= CORRIDOR_M + 900)) continue;

      const found = await layersFor(cell, kinds);
      if (!found.ok) throw new Error(`layers ${cell.south.toFixed(3)},${cell.west.toFixed(3)}: ${found.error}`);
      if (found.data.truncated) console.warn(`  ! cell ${cell.south.toFixed(3)},${cell.west.toFixed(3)} hit a cap — some of it is missing`);

      for (const spot of found.data.spots) {
        if (near(spot.point, paths)) spots.set(spot.id, { ...spot, point: roundPoint(spot.point) });
      }
      for (const lamp of found.data.lamps) {
        if (near(lamp.point, paths)) lamps.set(lamp.id, { id: lamp.id, point: roundPoint(lamp.point) });
      }
      for (const way of found.data.litWays) {
        if (way.path.some((point) => near(point, paths))) {
          litWays.set(way.id, { ...way, path: way.path.map(roundPoint) });
        }
      }
      console.log(`  layers ${cell.south.toFixed(3)},${cell.west.toFixed(3)}: ${spots.size} places, ${lamps.size} lamps, ${litWays.size} lit streets so far`);
    }
  }

  return { spots: [...spots.values()], lamps: [...lamps.values()], litWays: [...litWays.values()], truncated: false };
}

async function main(): Promise<void> {
  console.log("Recording the Utrecht scenario…");
  const legs = await recordLegs();
  const paths = Object.values(legs).flat().map((route) => route.path);
  const layers = await recordLayers(paths);

  const recording: ScenarioRecording = {
    recordedAt: new Date().toISOString(),
    sources: { routing: "routing.openstreetmap.de (OSRM, foot and bike)", overpass: OVERPASS },
    legs,
    layers,
  };
  writeFileSync(OUT, `${JSON.stringify(recording)}\n`);

  const routes = Object.values(legs).reduce((sum, list) => sum + list.length, 0);
  console.log("");
  console.log("=".repeat(60));
  console.log(` Scenario recorded → src/lib/scenario-recording.json`);
  console.log(` ${Object.keys(legs).length} legs, ${routes} routes`);
  console.log(` ${layers.spots.length} places, ${layers.lamps.length} lamps, ${layers.litWays.length} lit streets`);
  console.log(" Commit the file. Re-record only between rounds of interviews.");
  console.log("=".repeat(60));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
