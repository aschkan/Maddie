/**
 * What OpenStreetMap knows about the streets a route runs along.
 *
 * ONE data source, chosen deliberately. The alternative — recorded crime — is
 * published per neighbourhood per month, and a walking route usually sits
 * inside a single neighbourhood, so it gives every candidate route the same
 * number and cannot answer "which of these two streets". OSM changes metre by
 * metre, carries `lit=*` (the thing that most decides how a street feels after
 * dark, and the one you can act on by walking a different way), and is the same
 * data OSRM routed on — so the route and the read agree about the world.
 *
 * Asked for by the browser, but THROUGH THIS SERVER by default — `/api/osm/*`,
 * which goes out directly when it can and through the proxy chain when it
 * cannot. See `endpoints.ts` for why that is the default: the domain answers
 * from two machines and only one of them can reach OpenStreetMap.
 *
 * `options.base` still takes whatever you give it, so the parsing below is
 * testable without a network and a self-hosted Overpass is one edit away.
 *
 * A route read is not one request any more. It is cut into pieces that go out
 * SIMULTANEOUSLY, each through a different exit, and merged before anything is
 * counted — see the block above `chunkPath`. What the counting sees is
 * unchanged, and `readRoute` still runs once over the whole path.
 */

import { endpoint, forwarderFailure, rateLimitMessage, unreachableMessage } from "./endpoints.ts";
import { distanceM, distanceToPathM, pathLengthM, samplePath } from "./geo.ts";
import type { LatLng } from "./osrm.ts";

export const DEFAULT_OVERPASS = endpoint("overpass");

/** How far off the line something still counts as being on it. */
const ON_ROUTE_M = 20;
const NEARBY_M = 35;
const SAMPLE_EVERY_M = 25;

export interface RouteFacts {
  lengthM: number;
  samples: number;
  /** Samples standing on a way tagged `lit=yes`. */
  litSamples: number;
  /** Samples on a way tagged `lit=no`. Not the same as untagged. */
  unlitSamples: number;
  /**
   * Samples whose street says nothing about lighting.
   *
   * Kept apart from `unlitSamples` on purpose: most streets in most of the
   * world are simply untagged, and reading that as "unlit" would report a gap
   * in the map as a dark street.
   */
  unknownLitSamples: number;
  /** Samples on a dedicated footway, path or pedestrian street. */
  footwaySamples: number;
  /** Samples inside a park, wood or scrub — pleasant by day, empty by night. */
  greenSamples: number;
  lamps: number;
  /** Shops, cafes, bars and the like near the line — frontage, and people. */
  venues: number;
  crossings: number;
  /** Tunnels and underpasses crossed. */
  tunnels: number;
}

/**
 * What the map says at ONE point along the route.
 *
 * The aggregate counts below are these, summed. They are kept rather than
 * folded away because a single number for a whole walk cannot say the useful
 * thing: not "61/100", but "the dark part is the 400 m through the park".
 * `segments.ts` re-sums them over sliding windows to get exactly that, and it
 * costs nothing extra — every one of these was already computed on the way to
 * the totals.
 */
export interface SampleRead {
  point: LatLng;
  /** Metres from the start of the route, so a window can be cut by distance. */
  alongM: number;
  /**
   * What the street underfoot says about lighting.
   *
   * Three states, never two: most streets in most of the world are simply
   * untagged, and reading "unknown" as "no" reports a gap in the map as a dark
   * street.
   */
  lit: "yes" | "no" | "unknown";
  footway: boolean;
  green: boolean;
  /**
   * A key identifying the tunnel this point is inside, when it is in one.
   *
   * A key rather than a flag because tunnels are counted, not measured: twenty
   * consecutive points under one underpass are one underpass, and the same
   * de-duplication has to work over a window as it does over a route.
   */
  tunnelId?: string;
  /** The street's name, where OSM has one. Used to name a bad stretch. */
  street?: string;
  /** Nodes nearest to this point, so a stretch can be counted on its own. */
  lamps: number;
  venues: number;
  crossings: number;
}

/** The counts, and the points they were summed from. */
export interface RouteRead {
  facts: RouteFacts;
  reads: SampleRead[];
}

interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: { lat?: number; lon?: number }[];
}

/** Points every this far along the route, used as the spine of the corridor. */
const SPINE_EVERY_M = 150;
/**
 * A ceiling on the spine.
 *
 * The coordinate list is repeated once per clause, so the query grows as
 * points × clauses — 250 points made a 34 KB query, which Overpass has to
 * parse before it can refuse it.
 */
const MAX_SPINE_POINTS = 120;

/**
 * One Overpass query for everything the read needs, along a CORRIDOR.
 *
 * Not a bounding box. A bbox around a 7.4 km route across Amsterdam covers
 * 7.5 km² — fifteen times the area the route occupies — and asking for every
 * `way["highway"]` and every shop inside that is an expensive enough query that
 * Overpass answers 504 whenever it is busy. That failure comes and goes, which
 * reads like a flaky connection and is actually a query that is too big.
 *
 * `around:` takes a polyline and matches anything within a radius of it, so the
 * query asks about the streets the route runs along rather than the rectangle
 * it happens to span.
 *
 * ONE query per PIECE of the route — see `chunkPath` below. It used to be one
 * query for the whole thing, on the reasoning that Overpass hands out a couple
 * of slots per IP and parallel queries earn a 429. That holds only while every
 * query leaves from the same IP, which stopped being true when the forwarder
 * grew a pool of exits: four quarters through four exits are one query each,
 * not four.
 *
 * `out tags geom` is needed because ways have to be matched to the route by
 * geometry — OSRM returns a line, not OSM way ids. The `2000` is per query, so
 * splitting also raises what a long route can carry before it truncates.
 */
export function overpassQuery(path: LatLng[], timeoutS = 25): string | null {
  if (path.length < 2) return null;

  // The spine only bounds the search; more points than this lengthen the query
  // string without narrowing the corridor.
  let spine = samplePath(path, SPINE_EVERY_M);
  if (spine.length > MAX_SPINE_POINTS) {
    const stride = Math.ceil(spine.length / MAX_SPINE_POINTS);
    spine = spine.filter((_, index) => index % stride === 0 || index === spine.length - 1);
  }
  if (spine.length < 2) return null;

  // Five decimals is about a metre — more is noise in a 35 m corridor and only
  // makes the query longer.
  const line = spine.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(",");
  const near = `around:${NEARBY_M},${line}`;

  return `[out:json][timeout:${timeoutS}];
(
  way["highway"](${near});
  way["landuse"~"^(forest|grass|meadow|village_green)$"](${near});
  way["leisure"~"^(park|garden|nature_reserve)$"](${near});
  way["natural"~"^(wood|scrub)$"](${near});
  node["highway"~"^(street_lamp|crossing)$"](${near});
  node["amenity"~"^(cafe|bar|pub|restaurant|fast_food|pharmacy|fuel|police|hospital)$"](${near});
  node["shop"](${near});
);
out tags geom 2000;`;
}

function wayPath(element: OverpassElement): LatLng[] {
  const out: LatLng[] = [];
  for (const point of element.geometry ?? []) {
    if (typeof point?.lat === "number" && typeof point?.lon === "number") {
      out.push({ lat: point.lat, lng: point.lon });
    }
  }
  return out;
}

const GREEN = (tags: Record<string, string>): boolean =>
  /^(forest|grass|meadow|village_green)$/.test(tags.landuse ?? "") ||
  /^(park|garden|nature_reserve)$/.test(tags.leisure ?? "") ||
  /^(wood|scrub)$/.test(tags.natural ?? "");

const FOOTWAY = /^(footway|path|pedestrian|steps|living_street)$/;

/** Metres from the start of the route to each sample, in order. */
function alongMetres(samples: LatLng[]): number[] {
  const along: number[] = [];
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const here = samples[i];
    const previous = samples[i - 1];
    if (i > 0 && here && previous) total += distanceM(previous, here);
    along.push(total);
  }
  return along;
}

/**
 * The sample a node belongs to: the nearest one.
 *
 * Nodes are counted against a POINT on the route rather than the route as a
 * whole so that a stretch can be counted on its own — twelve cafes clustered at
 * the far end are not frontage along the dark middle, and the aggregate could
 * never tell the two apart.
 */
function nearestSample(point: LatLng, samples: LatLng[]): number {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (!sample) continue;
    const d = distanceM(point, sample);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Turn Overpass elements into the numbers the score is built from.
 *
 * Deliberately deterministic and separate from any model: these are counts of
 * what the map says, and nothing here is a judgement. The judgement is applied
 * afterwards, to numbers that can be checked.
 *
 * Both resolutions come out of the one pass. The totals are what the score and
 * the model are given; the per-point reads are what `segments.ts` re-sums to
 * find the worst stretch. Computing them twice would mean two answers that can
 * drift apart, and the second pass is not free — matching a point to the street
 * underfoot is the expensive part of this whole app.
 */
export function readRoute(path: LatLng[], elements: OverpassElement[]): RouteRead {
  const samples = samplePath(path, SAMPLE_EVERY_M);
  const along = alongMetres(samples);

  const highways: { tags: Record<string, string>; line: LatLng[] }[] = [];
  const greens: LatLng[][] = [];

  const reads: SampleRead[] = samples.map((point, index) => ({
    point,
    alongM: along[index] ?? 0,
    lit: "unknown",
    footway: false,
    green: false,
    lamps: 0,
    venues: 0,
    crossings: 0,
  }));

  let lamps = 0;
  let venues = 0;
  let crossings = 0;

  for (const element of elements) {
    const tags = element.tags ?? {};

    if (element.type === "node") {
      if (typeof element.lat !== "number" || typeof element.lon !== "number") continue;
      const point = { lat: element.lat, lng: element.lon };
      const away = distanceToPathM(point, path);

      let counted: "lamps" | "venues" | "crossings" | null = null;
      if (tags.highway === "street_lamp") {
        if (away <= NEARBY_M) { lamps++; counted = "lamps"; }
      } else if (tags.highway === "crossing") {
        if (away <= ON_ROUTE_M) { crossings++; counted = "crossings"; }
      } else if (tags.amenity || tags.shop) {
        if (away <= NEARBY_M) { venues++; counted = "venues"; }
      }

      if (counted) {
        const index = nearestSample(point, samples);
        const read = reads[index];
        if (read) read[counted]++;
      }
      continue;
    }

    if (element.type !== "way") continue;
    const line = wayPath(element);
    if (line.length < 2) continue;

    if (tags.highway) highways.push({ tags, line });
    else if (GREEN(tags)) greens.push(line);
  }

  let litSamples = 0;
  let unlitSamples = 0;
  let unknownLitSamples = 0;
  let footwaySamples = 0;
  let greenSamples = 0;
  const tunnelIds = new Set<string>();

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const read = reads[index];
    if (!sample || !read) continue;

    // The street this sample is standing on: the nearest highway within
    // ON_ROUTE_M. Anything further away is a different street.
    let nearest: { tags: Record<string, string>; d: number } | null = null;
    for (const way of highways) {
      const d = distanceToPathM(sample, way.line);
      if (d <= ON_ROUTE_M && (nearest === null || d < nearest.d)) nearest = { tags: way.tags, d };
    }

    if (nearest) {
      const lit = nearest.tags.lit;
      if (lit === "yes" || lit === "24/7" || lit === "sunset-sunrise") { litSamples++; read.lit = "yes"; }
      else if (lit === "no") { unlitSamples++; read.lit = "no"; }
      else unknownLitSamples++;

      if (FOOTWAY.test(nearest.tags.highway ?? "")) { footwaySamples++; read.footway = true; }
      if (nearest.tags.tunnel && nearest.tags.tunnel !== "no") {
        const id = `${nearest.tags.name ?? ""}:${nearest.tags.tunnel}`;
        tunnelIds.add(id);
        read.tunnelId = id;
      }
      // The name is for saying WHICH stretch is the bad one. An unnamed way
      // stays unnamed rather than being given a made-up label.
      if (nearest.tags.name) read.street = nearest.tags.name;
    } else {
      unknownLitSamples++;
    }

    for (const green of greens) {
      if (distanceToPathM(sample, green) <= ON_ROUTE_M) {
        greenSamples++;
        read.green = true;
        break;
      }
    }
  }

  return {
    reads,
    facts: {
      lengthM: Math.round(pathLengthM(path)),
      samples: samples.length,
      litSamples,
      unlitSamples,
      unknownLitSamples,
      footwaySamples,
      greenSamples,
      lamps,
      venues,
      crossings,
      tunnels: tunnelIds.size,
    },
  };
}

/** Just the totals, for callers that have no use for the individual points. */
export function computeFacts(path: LatLng[], elements: OverpassElement[]): RouteFacts {
  return readRoute(path, elements).facts;
}

/* ─────────────────── one route, several queries, in parallel ────────────────
 *
 * A route read used to be ONE Overpass query over the whole corridor, sent on
 * its own because parallel queries are what earn a 429. That reasoning was
 * right while every query left from the same IP. It does not hold once the
 * forwarder has a pool of exits: the limit Overpass applies is per IP, so four
 * quarters of a route asked simultaneously through four different exits are
 * four requests of one apiece rather than one request of four — and they come
 * back in the time the slowest quarter takes rather than the sum.
 *
 * What makes that true is that the exits really are different. `rank()` in
 * `proxy-pool.ts` skips a hop that is already carrying a request, so parallel
 * chunks are handed distinct proxies without anything here having to ask for
 * one; `MIN_WORKING` is set above the chunk count so there are normally enough
 * to go round. When there are not, the pool shares one, which is no worse than
 * the single query this replaced.
 *
 * Two things it also fixes, incidentally: `out ... 2000` is a per-query cap, so
 * four queries carry four times as much of a long route before truncating; and
 * `MAX_SPINE_POINTS` is per query too, so the corridor is described at a finer
 * grain.
 */

/**
 * How many pieces a route may be split into, at most.
 *
 * Twelve. It was four, which is the wrong shape of limit: a long walk is
 * exactly the case that needs spreading, and capping it at four means a 30 km
 * route asks four enormous queries — each nearer the `out ... 2000` truncation
 * and nearer Overpass's own timeout — while the pool sits idle.
 *
 * What actually bounds the split is the pool, not this: `piecesFor()` sizes it
 * to the exits the server says it has. This is only the ceiling, and it is here
 * because a piece is a whole Overpass query with a round trip of its own, so
 * past a dozen the coordination costs more than the parallelism returns.
 */
export const MAX_CHUNKS = 12;

/**
 * The shortest piece worth cutting.
 *
 * A 900 m walk split four ways is four queries that each cost a round trip and
 * a slot to answer a question one query answers as fast. The split earns its
 * keep on the long routes, which are also the ones that were timing out.
 */
export const CHUNK_MIN_M = 1_500;

/**
 * Roughly how long a piece should be.
 *
 * The split is driven by LENGTH as well as by the pool, because the two answer
 * different questions. The pool says how many queries can be in the air at
 * once; this says how many the route actually warrants. A 3 km walk gains
 * nothing from being cut twelve ways even on a box with sixty exits — the
 * pieces would be 250 m each and the round trips would dominate.
 *
 * 2.5 km is a few minutes' walk and comfortably inside what one Overpass query
 * answers without truncating.
 */
export const CHUNK_TARGET_M = 2_500;

/**
 * Cut a route into contiguous pieces of roughly equal length.
 *
 * The boundary vertex belongs to BOTH neighbours. That is not an off-by-one:
 * Overpass's `around:` matches within a radius of the polyline, so two corridors
 * that share an endpoint join up with no gap between them, while two that stop
 * one vertex short of each other leave an unqueried notch in the middle of the
 * route — which `readRoute` would then report as street with nothing mapped on
 * it, and the map would draw grey. "We did not ask here" must never render as
 * "nobody has mapped this".
 */
export function chunkPath(path: LatLng[], maxChunks = MAX_CHUNKS): LatLng[][] {
  if (path.length < 2) return [];

  const total = pathLengthM(path);
  const wanted = Math.max(1, Math.min(maxChunks, Math.floor(total / CHUNK_MIN_M)));
  if (wanted <= 1) return [path];

  const target = total / wanted;
  const chunks: LatLng[][] = [];
  const first = path[0];
  if (!first) return [];
  let current: LatLng[] = [first];
  let run = 0;

  for (let i = 1; i < path.length; i++) {
    const previous = path[i - 1];
    const here = path[i];
    if (!previous || !here) continue;
    run += distanceM(previous, here);
    current.push(here);
    // Never close the last chunk early, and never leave a chunk with one point
    // in it — `overpassQuery` needs two to describe a corridor at all.
    if (run >= target && chunks.length < wanted - 1 && i < path.length - 1) {
      chunks.push(current);
      current = [here];
      run = 0;
    }
  }
  chunks.push(current);
  return chunks;
}

/*
 * How many pieces this server can actually carry at once.
 *
 * Reported by the forwarder on every reply as `x-osm-exits` — working exits
 * that are free right now, plus one if the server can reach OpenStreetMap
 * directly. Remembered here and used to size the NEXT split.
 *
 * This exists because a fixed split of four met a box that could not carry it:
 * four working exits with nineteen resting after rate limits, so the fourth
 * piece of every route read found nothing available and failed the whole read
 * with "no route out worked" while the other three came back fine.
 *
 * Feeding the number back beats asking for it: no extra request before every
 * read, and it corrects itself as exits die and fresh ones are scraped.
 *
 * It starts optimistic — at what a pool with exits to spare looks like — rather
 * than at 1. The first read of a session has no reply to learn from, and
 * starting pessimistic would make the common case permanently slow for anyone
 * who only ever plans one route.
 */
let knownExits = 8;

/** What the server last said it could carry. Exported for the tests. */
export function exitsAvailable(): number {
  return knownExits;
}

/**
 * How many pieces to actually ask for, given that many exits.
 *
 * HALF, rounded up, and the halving is the point. A piece is not one request:
 * when the exit it went out through fails, it rotates, up to four times. So a
 * read split as many ways as there are free exits does not use one exit per
 * piece — it contends for them, and on a pool of mostly-dead public proxies the
 * unlucky piece spends all four attempts on corpses and fails, which fails the
 * whole read.
 *
 * The numbers that showed this: a real box reported four working exits with
 * nineteen resting after rate limits. A four-way split there needs up to
 * sixteen exit-uses from four good proxies at four to eight seconds apiece.
 * Two pieces down four exits is the same read with room for every piece to
 * rotate twice.
 */
export function piecesFor(exits: number): number {
  return Math.max(1, Math.min(MAX_CHUNKS, Math.ceil(exits / 2)));
}

/**
 * How many pieces THIS route wants, given the pool and its own length.
 *
 * The smaller of the two, because they bound different things. A long route on
 * a starved pool must not ask for more queries than there are exits to carry
 * them — that is the failure this whole thread started from. A short route on a
 * healthy pool must not be cut into slivers just because it could be.
 */
export function piecesForRoute(lengthM: number, exits: number): number {
  const byLength = Math.max(1, Math.round(lengthM / CHUNK_TARGET_M));
  return Math.max(1, Math.min(MAX_CHUNKS, byLength, piecesFor(exits)));
}

/** Reset what has been learned. Tests only. */
export function forgetExits(): void {
  knownExits = 8;
}

function learnExits(response: Response): void {
  const raw = response.headers.get("x-osm-exits");
  if (raw === null) return;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return;
  /*
   * Never below 1. Zero exits is a real answer — the pool is empty and the box
   * cannot go out directly — but a zero-piece split is not a smaller request,
   * it is no request at all, and the read would fail with nothing tried rather
   * than failing with a reason.
   */
  knownExits = Math.max(0, Math.floor(parsed));
}

/** What one chunk's query came back with. */
type ChunkReply =
  | { ok: true; elements: OverpassElement[] }
  | { ok: false; error: string; limited: boolean; cancelled: boolean };

async function askOverpass(query: string, base: string, signal?: AbortSignal): Promise<ChunkReply> {
  const fail = (error: string, over: Partial<ChunkReply> = {}): ChunkReply =>
    ({ ok: false, error, limited: false, cancelled: false, ...over }) as ChunkReply;

  try {
    const response = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal,
    });

    /*
     * The rate limit, said out loud.
     *
     * By the time a 429 reaches here the server has already rotated this
     * request through every exit it has — that is what `rotate()` does, and
     * `exitsTried` in the body says how many it spent. So there is nothing
     * left to try quietly, and the person waiting on the map is told plainly
     * rather than watching a spinner while it is retried behind their back.
     */
    // Whatever it answered, it said how much this server can carry. The error
    // replies carry it too — those are exactly when it has changed.
    learnExits(response);

    if (response.status === 429) {
      return fail(await rateLimitMessage(response, "the map data"), { limited: true });
    }
    if (response.status === 504) {
      // Overpass timed out running the query. It reached them — this is not a
      // connection problem, and saying so stops the next hour being spent on
      // the network instead of on the query.
      return fail(
        "OpenStreetMap's query service timed out on this route. It is busy — try again, or try a shorter route.",
      );
    }
    const ours = forwarderFailure("overpass", response.status);
    if (ours) return fail(ours);
    if (!response.ok) return fail(`OpenStreetMap's query service answered ${response.status}.`);

    const body = (await response.json()) as { elements?: OverpassElement[] };
    if (!Array.isArray(body?.elements)) return fail("OpenStreetMap sent something unreadable.");
    return { ok: true, elements: body.elements };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return fail("cancelled", { cancelled: true });
    }
    return fail(unreachableMessage("overpass", "OpenStreetMap's query service"));
  }
}

/**
 * Merge the chunks' replies into one element list.
 *
 * Deduplicated by `type/id`, because adjacent corridors overlap around the
 * vertex they share and will both return the ways crossing it. Counting a lamp
 * twice because the route happened to be cut beside it would make the score
 * depend on where the split fell, which is an implementation detail and must
 * not be visible in the answer.
 */
function mergeElements(replies: readonly OverpassElement[][]): OverpassElement[] {
  const seen = new Set<string>();
  const out: OverpassElement[] = [];
  for (const elements of replies) {
    for (const element of elements) {
      // An element with no id cannot be deduplicated, so it is kept as-is
      // rather than dropped — Overpass does emit those for derived geometry.
      const key = element.id === undefined ? null : `${element.type ?? "?"}/${element.id}`;
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(element);
    }
  }
  return out;
}

/**
 * Ask Overpass for everything a route read needs. Never throws.
 *
 * The route is cut into pieces and the pieces go out AT ONCE, each through its
 * own exit — see the block above. The counting afterwards is unchanged and runs
 * over the whole path against the merged elements, so the answer does not
 * depend on where the cuts fell.
 */
export async function fetchFacts(
  path: LatLng[],
  options: { base?: string; signal?: AbortSignal } = {},
): Promise<{ ok: true; facts: RouteFacts; reads: SampleRead[] } | { ok: false; error: string }> {
  /*
   * Never more pieces than the server has ways out for.
   *
   * Asking for four when it can carry two is not four fast pieces, it is two
   * fast ones and two that find every exit busy — and one piece that cannot be
   * read fails the whole read, by design. Two pieces down two exits beats four
   * down two.
   */
  const chunks = chunkPath(path, piecesForRoute(pathLengthM(path), knownExits));
  const queries = chunks.map((chunk) => overpassQuery(chunk)).filter((query): query is string => query !== null);
  if (queries.length === 0) return { ok: false, error: "No route to look at." };

  const base = options.base ?? DEFAULT_OVERPASS;
  const replies = await Promise.all(queries.map((query) => askOverpass(query, base, options.signal)));

  // A cancelled read is not a failure to report; the caller has moved on.
  if (replies.some((reply) => !reply.ok && reply.cancelled)) return { ok: false, error: "cancelled" };

  /*
   * A rate limit outranks any other failure in the batch.
   *
   * It is the one that is temporary, the one that is nobody's fault, and the
   * one with an action attached — wait a minute. Reporting a neighbouring
   * chunk's 502 instead would send the reader to check a server that is fine.
   */
  const limited = replies.find((reply) => !reply.ok && reply.limited);
  if (limited && !limited.ok) return { ok: false, error: limited.error };

  /*
   * One piece missing fails the whole read, deliberately.
   *
   * The alternative — counting what came back — is worse than it looks: the
   * unfetched stretch has no ways under it, so every sample along it counts as
   * having no lighting information, and the map draws it grey with "nobody has
   * mapped this". That is a claim about OpenStreetMap, and it would be false.
   * A read that declines to answer costs a retry; one that quietly answers for
   * three quarters of a walk is wrong about the quarter that matters.
   */
  const failed = replies.find((reply) => !reply.ok);
  if (failed && !failed.ok) {
    const part = replies.length > 1 ? ` (one of ${replies.length} parts of the route)` : "";
    return { ok: false, error: `${failed.error}${part}` };
  }

  const elements = mergeElements(
    replies.map((reply) => (reply.ok ? reply.elements : [])),
  );
  const read = readRoute(path, elements);
  return { ok: true, facts: read.facts, reads: read.reads };
}
