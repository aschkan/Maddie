/**
 * OpenStreetMap, fetched by this server instead of by the browser.
 *
 * THIS IS THE DEFAULT PATH for tiles, routing, search and Overpass — see
 * `src/lib/endpoints.ts`, which is where the browser is pointed here. Asking
 * for them from the browser is the tidier shape and was the default once: no
 * server in the path, nothing to scale, nothing to pay for. It stops working
 * the moment the visitor's network, or this server's, cannot reach those hosts
 * — and this app answers from two machines, only one of which can.
 *
 * So these paths mirror the upstreams one for one. Going out is directly where
 * that works and through the entry proxy and the fastest live exit where it
 * does not, which makes both machines behave the same from the browser's side.
 *
 * Two things it now does that are worth knowing before reading the code:
 *
 *   * a route read arrives here as SEVERAL simultaneous requests, one per piece
 *     of the route (`chunkPath` in `overpass.ts`). The pool hands each of them a
 *     different exit, because `rank()` skips a hop already carrying a request —
 *     which is what makes them count as one query per IP rather than four.
 *   * when every exit is rate limited it answers **429**, not 502. Those are
 *     different failures and only one of them is this server's fault; the client
 *     turns the first into "we have reached OpenStreetMap's rate limit".
 *
 * ⚠ This app's OWN API is not served from here and must never be. `/api/assess`
 * and `/api/reports` are same-origin calls to the box that served the page;
 * there is nothing to reach around, and `SERVICES` holds neither of them.
 *
 * The upstream is chosen from a fixed table, never from the request. A
 * forwarder that takes its target from a query parameter is an open proxy, and
 * an open proxy on someone's server is their problem within the day.
 */

import { NextResponse } from "next/server";

import { requestThrough } from "@/lib/proxy-chain";
import { cacheKey, osmCache } from "@/lib/osm-cache";
import { SERVICES, nothingWorked, shouldRotate, upstreamUrl, type Service } from "@/lib/osm-forward";
import { allowDirectFallback, pool, USER_AGENT, type HopState } from "@/lib/proxy-pool";

export const dynamic = "force-dynamic";

async function forward(request: Request, service: Service, name: string, parts: string[]): Promise<Response> {
  const url = new URL(request.url);
  if (upstreamUrl(service, parts, url.search) === null) {
    return NextResponse.json({ error: "Bad path." }, { status: 400 });
  }

  const method = request.method === "POST" ? "POST" : "GET";
  if (!service.methods.includes(method)) {
    return NextResponse.json({ error: `${method} is not forwarded.` }, { status: 405 });
  }

  const body = method === "POST" ? Buffer.from(await request.arrayBuffer()) : undefined;
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: request.headers.get("accept") ?? "*/*",
  };
  const contentType = request.headers.get("content-type");
  if (body && contentType) headers["Content-Type"] = contentType;

  /*
   * Already have it?
   *
   * This is the first thing tried and the reason the rate limit stops being
   * hit: an answer served from here is a request that was never made, which
   * is a better answer to "we are over the limit" than making the same
   * request from somewhere else.
   */
  const cache = osmCache();
  const key = cacheKey(name, method, url.pathname, url.search, body);
  const stored = cache.get(key, service.ttlMs);
  if (stored) {
    const out = new Headers();
    if (stored.contentType) out.set("content-type", stored.contentType);
    out.set("cache-control", service.cache);
    out.set("x-osm-via", "cache");
    out.set("x-osm-attempts", "0");
    out.set("x-osm-exits", String(pool().capacity()));
    return new Response(new Uint8Array(stored.body), { status: stored.status, headers: out });
  }

  const proxies = pool();

  const keep = (status: number, headers: Record<string, string>, payload: Buffer) => {
    cache.set(key, {
      status,
      contentType: headers["content-type"] ?? null,
      body: payload,
      at: Date.now(),
    });
  };

  const send = async (state: HopState | null, attempt: number) => {
    const target = upstreamUrl(service, parts, url.search, attempt);
    if (!target) throw new Error("no upstream configured");
    return await requestThrough(target, {
      // `entryFor()`, not `entry`: null once the LAN proxy has been found
      // unreachable, which is what lets the list be tried at all.
      entry: proxies.entryFor(),
      hop: state?.hop ?? null,
      timeoutMs: proxies.timeoutMs,
      method,
      headers,
      ...(body ? { body } : {}),
    });
  };

  /*
   * Which mirror this request starts on.
   *
   * NOT zero, and that was a real bug. A route read arrives here as up to four
   * simultaneous requests, and on a server where `directWorks` is true every
   * one of them goes out directly — from the same IP. With a hardcoded mirror
   * they all landed on `overpass-api.de` at once, which hands out a couple of
   * slots per IP, so the last of them were refused: two pieces of the route
   * came back and one did not, and the page showed a confident score above a
   * red error saying the server could not reach OpenStreetMap.
   *
   * A turn apiece spreads them, because the limit is per IP PER HOST. That is
   * what makes the parallel split safe on a box with one way out.
   */
  const firstMirror = proxies.mirrorTurn();

  /*
   * Straight out first, when that has been SHOWN to work.
   *
   * The two machines this is deployed on differ in exactly this. Sending every
   * tile from the one that has working internet through a public proxy would
   * be slower, less private and more fragile than just fetching it, and the
   * proxy list exists for the machine that cannot. `directWorks` is only true
   * after a probe succeeded, so the blocked machine never pays a timeout to
   * rediscover that it is blocked.
   */
  let directSaid: number | null = null;
  /*
   * `takeDirect()`, not `directWorks`.
   *
   * Direct is ONE exit — this server's own IP — however many proxies the pool
   * holds, and this used to be taken by every request that wanted it. So the
   * pieces of a parallel route read all left from the same address at once,
   * which is the per-IP limit the split exists to get under. The pieces that
   * cannot have it go straight to a proxy, which is what the pool is for.
   */
  if (proxies.configured && proxies.takeDirect()) {
    try {
      const response = await send(null, firstMirror);
      /*
       * A 429 or a 5xx going out directly is EXACTLY when the proxy list earns
       * its keep — the limit is per exit IP, and this server's own IP has just
       * used up its share. Returning it here was the bug: with `directOk` true
       * every request went straight out, the rate limit came straight back,
       * and the exits were never consulted at all.
       */
      if (!shouldRotate(response.status)) {
        keep(response.status, response.headers, response.body);
        return reply(response.status, response.headers, response.body, service, "direct", 1, proxies.capacity());
      }
      /*
       * Remember WHAT it said before falling through.
       *
       * Thrown away, this is how a rate limit came to be reported as
       * unreachability: direct answered 429, the pool had no working exit to
       * rotate to, and the 502 for "nothing got out" was returned instead —
       * sending whoever read it to check a network that was fine.
       */
      directSaid = response.status;
    } catch {
      // Fall through to the proxies — the probe is a few minutes old at most,
      // but "it worked last sweep" is not a promise about this second.
    } finally {
      proxies.releaseDirect();
    }
  }

  // No chain configured at all: straight out, exactly as the browser would
  // have done. This route is then only a same-origin hop, which is still worth
  // having when it is the VISITOR's network doing the blocking.
  if (!proxies.configured) {
    try {
      const response = await send(null, firstMirror);
      keep(response.status, response.headers, response.body);
      return reply(response.status, response.headers, response.body, service, "direct", 1, proxies.capacity());
    } catch (error) {
      return unreachable(error instanceof Error ? [error.message] : [], [], proxies.capacity());
    }
  }

  // Each retry changes BOTH the exit and the mirror, because the limit being
  // worked around is per IP per host. It starts one past the mirror the direct
  // attempt just used, so the first proxy does not re-ask the host that has
  // already refused us.
  let attempt = firstMirror + 1;
  const result = await proxies.rotate(async (state) => {
    const response = await send(state, attempt++);
    if (shouldRotate(response.status)) {
      return {
        done: false as const,
        reason: `upstream answered ${response.status}`,
        // A 429 is about this exit's IP, so it steps aside for a minute.
        // Anything else the upstream said is not the proxy's doing, and
        // holding it against the proxy empties the pool whenever a
        // destination is down.
        fault: response.status === 429 ? ("limit" as const) : ("upstream" as const),
      };
    }
    return { done: true as const, value: response };
  });

  if (result.ok) {
    keep(result.value.status, result.value.headers, result.value.body);
    return reply(result.value.status, result.value.headers, result.value.body, service, result.via, result.attempts, proxies.capacity());
  }

  /*
   * One more go, straight out, on a mirror nothing has tried yet.
   *
   * This is the retry that saves the read on the machine this actually runs
   * on, where the pool of public proxies is usually empty and direct is the
   * only way out. It is NOT a repeat of the direct attempt at the top: that
   * one used `firstMirror`, this one uses the mirror after everything the
   * rotation touched, and the refusal being worked around is per host.
   *
   * Only where direct has been probed and works. On the blocked machine this
   * would be a guaranteed timeout on the end of every failed request, which is
   * why it is `directWorks` rather than a flag somebody has to know to set.
   */
  let fallbackSaid: number | null = null;
  const haveDirect = allowDirectFallback(proxies) && proxies.takeDirect();
  if (haveDirect) {
    try {
      const response = await send(null, attempt + 1);
      if (!shouldRotate(response.status)) {
        keep(response.status, response.headers, response.body);
        return reply(response.status, response.headers, response.body, service, "direct", result.tried.length + 1, proxies.capacity());
      }
      fallbackSaid = response.status;
      result.reasons.push(`direct: answered ${response.status}`);
    } catch (error) {
      result.reasons.push(`direct: ${error instanceof Error ? error.message : "failed"}`);
    } finally {
      proxies.releaseDirect();
    }
  }

  /*
   * Rate limited — say THAT, not "nothing got out".
   *
   * Three ways to arrive here and they are one situation: every exit came back
   * 429, or the direct attempt did, or the direct retry did. The last two are
   * the common case on this deployment, because a list of public proxies is
   * usually empty of working ones and `rotate()` then returns having tried
   * nothing at all.
   *
   * Losing that distinction is what produced the error this fixes. Direct
   * answered 429, the pool had no exit to rotate to, and the reply was the 502
   * for "no route out worked" — so the page reported unreachability for a
   * server whose network was fine, above a route it had just finished scoring.
   *
   * `exitsTried` is what turns the client's sentence from "we are being rate
   * limited" into "we tried four exits and each was refused". Zero exits is an
   * honest answer too: the helper then simply says the limit was reached.
   */
  const outcome = nothingWorked({
    rotationLimited: result.limited,
    directStatus: directSaid,
    fallbackStatus: fallbackSaid,
  });
  if (outcome === "rate-limited") {
    return NextResponse.json(
      {
        error: "OpenStreetMap is rate limiting us.",
        exitsTried: result.tried.length,
        tried: result.tried,
        reasons: result.reasons.slice(0, 6),
      },
      // Never cached: storing a refusal for the service's TTL turns one minute
      // of rate limiting into ten. `keep()` is deliberately not called here.
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "x-osm-attempts": String(result.tried.length),
          "x-osm-exits": String(proxies.capacity()),
        },
      },
    );
  }

  return unreachable(result.reasons, result.tried, proxies.capacity());
}

function reply(
  status: number,
  headers: Record<string, string>,
  body: Buffer,
  service: Service,
  via: string,
  attempts: number,
  exits: number,
): Response {
  const out = new Headers();
  const type = headers["content-type"];
  if (type) out.set("content-type", type);
  out.set("cache-control", status === 200 ? service.cache : "no-store");
  // Which exit answered, and how many it took. This is the one number worth
  // watching when the page is slow — see /api/osm/status for the rest.
  out.set("x-osm-via", via);
  out.set("x-osm-attempts", String(attempts));
  /*
   * How many distinct ways out this server can supply at once.
   *
   * The client sizes its route split by this. A fixed split met a pool that
   * could not carry it — four pieces asked of a box with four working exits,
   * nineteen of them resting after rate limits — and the piece that found
   * nothing available failed the whole read. Feeding the number back on every
   * reply is what keeps the two ends in step without an extra request, and it
   * self-corrects as exits die and are found.
   */
  out.set("x-osm-exits", String(exits));
  return new Response(new Uint8Array(body), { status, headers: out });
}

/**
 * Nothing in the chain answered.
 *
 * 502, with the reasons, because "the proxies are all dead" and "OpenStreetMap
 * said no" are different problems and the page cannot tell them apart from a
 * blank reply. The client turns this into "could not reach OpenStreetMap",
 * which is true either way, and the detail is here for whoever is debugging.
 */
function unreachable(reasons: string[], tried: string[], exits: number): Response {
  return NextResponse.json(
    {
      error: "No route out reached OpenStreetMap.",
      tried,
      reasons: reasons.slice(0, 6),
      hint: "Check /api/osm/status. If every hop failed at CONNECT with 403, the entry proxy is refusing CONNECT to non-443 ports — that is its ACL, not the list.",
    },
    { status: 502, headers: { "cache-control": "no-store", "x-osm-exits": String(exits) } },
  );
}

/*
 * An OPTIONAL catch-all — `[[...path]]`, two brackets.
 *
 * With one, `/api/osm/overpass` itself does not match and answers 404, because
 * a `[...path]` segment insists on at least one part. The client POSTs Overpass
 * queries to exactly that bare path.
 */
type Context = { params: Promise<{ service: string; path?: string[] }> };

async function handle(request: Request, context: Context): Promise<Response> {
  const { service: name, path } = await context.params;
  const service = SERVICES[name];
  if (!service) return NextResponse.json({ error: "No such service." }, { status: 404 });
  return forward(request, service, name, path ?? []);
}

export async function GET(request: Request, context: Context): Promise<Response> {
  return handle(request, context);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return handle(request, context);
}
