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
 * `NEXT_PUBLIC_OSM_DIRECT=1` sends the browser straight out again, and a
 * per-service `NEXT_PUBLIC_*_URL` still names a self-hosted upstream.
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
import { SERVICES, shouldRotate, upstreamUrl, type Service } from "@/lib/osm-forward";
import { ALLOW_DIRECT, pool, USER_AGENT, type HopState } from "@/lib/proxy-pool";

export const dynamic = "force-dynamic";

async function forward(request: Request, service: Service, parts: string[]): Promise<Response> {
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

  const proxies = pool();

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
   * Straight out first, when that has been SHOWN to work.
   *
   * The two machines this is deployed on differ in exactly this. Sending every
   * tile from the one that has working internet through a public proxy would
   * be slower, less private and more fragile than just fetching it, and the
   * proxy list exists for the machine that cannot. `directWorks` is only true
   * after a probe succeeded, so the blocked machine never pays a timeout to
   * rediscover that it is blocked.
   */
  if (proxies.configured && proxies.directWorks) {
    try {
      const response = await send(null, 0);
      return reply(response.status, response.headers, response.body, service, "direct", 1);
    } catch {
      // Fall through to the proxies — the probe is a few minutes old at most,
      // but "it worked last sweep" is not a promise about this second.
    }
  }

  // No chain configured at all: straight out, exactly as the browser would
  // have done. This route is then only a same-origin hop, which is still worth
  // having when it is the VISITOR's network doing the blocking.
  if (!proxies.configured) {
    try {
      const response = await send(null, 0);
      return reply(response.status, response.headers, response.body, service, "direct", 1);
    } catch (error) {
      return unreachable(error instanceof Error ? [error.message] : [], []);
    }
  }

  // Each retry changes BOTH the exit and the mirror, because the limit being
  // worked around is per IP per host.
  let attempt = 0;
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
    return reply(result.value.status, result.value.headers, result.value.body, service, result.via, result.attempts);
  }

  if (ALLOW_DIRECT) {
    try {
      const response = await send(null, attempt);
      return reply(response.status, response.headers, response.body, service, "direct", result.tried.length + 1);
    } catch (error) {
      result.reasons.push(`direct: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  return unreachable(result.reasons, result.tried);
}

function reply(
  status: number,
  headers: Record<string, string>,
  body: Buffer,
  service: Service,
  via: string,
  attempts: number,
): Response {
  const out = new Headers();
  const type = headers["content-type"];
  if (type) out.set("content-type", type);
  out.set("cache-control", status === 200 ? service.cache : "no-store");
  // Which exit answered, and how many it took. This is the one number worth
  // watching when the page is slow — see /api/osm/status for the rest.
  out.set("x-osm-via", via);
  out.set("x-osm-attempts", String(attempts));
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
function unreachable(reasons: string[], tried: string[]): Response {
  return NextResponse.json(
    {
      error: "No route out reached OpenStreetMap.",
      tried,
      reasons: reasons.slice(0, 6),
      hint: "Check /api/osm/status. If every hop failed at CONNECT with 403, the entry proxy is refusing CONNECT to non-443 ports — that is its ACL, not the list.",
    },
    { status: 502, headers: { "cache-control": "no-store" } },
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
  return forward(request, service, path ?? []);
}

export async function GET(request: Request, context: Context): Promise<Response> {
  return handle(request, context);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return handle(request, context);
}
