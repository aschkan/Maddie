/**
 * The one place any server-side upstream is fetched.
 *
 * undici's own `fetch` with undici's own `ProxyAgent`, both from the same copy
 * in node_modules. Handing a dispatcher from one module instance to the global
 * fetch of another works until a Node upgrade quietly stops it working, and the
 * failure looks like "the proxy is ignored", which reads as "the network is
 * down".
 */
import { fetch as undiciFetch, ProxyAgent, Agent, type Dispatcher } from "undici";
import { getConfig } from "../config.ts";
import { logger } from "../log.ts";
import { parseProxyPool, rankProxies, shouldProxy, type ProxyEntry, type ProxyHealth } from "./proxy.ts";

const log = logger("http");

/** Our own deadline fired. Says nothing about the destination. */
export class UpstreamTimeoutError extends Error {
  readonly kind = "timeout";
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms: ${url}`);
    this.name = "UpstreamTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

/** Could not get a connection at all — every route to the host failed. */
export class UpstreamTransportError extends Error {
  readonly kind = "transport";
  readonly url: string;
  readonly attempts: string[];

  constructor(url: string, attempts: string[], cause?: unknown) {
    super(`could not reach ${url} (tried: ${attempts.join(", ") || "direct"})`);
    this.name = "UpstreamTransportError";
    this.url = url;
    this.attempts = attempts;
    this.cause = cause;
  }
}

/** The upstream answered, but not with something usable. */
export class UpstreamStatusError extends Error {
  readonly kind = "status";
  readonly url: string;
  readonly status: number;
  readonly body: string;

  constructor(url: string, status: number, body: string) {
    super(`${status} from ${url}`);
    this.name = "UpstreamStatusError";
    this.url = url;
    this.status = status;
    this.body = body;
  }
}

export type UpstreamError = UpstreamTimeoutError | UpstreamTransportError | UpstreamStatusError;

export function isUpstreamError(error: unknown): error is UpstreamError {
  return (
    error instanceof UpstreamTimeoutError ||
    error instanceof UpstreamTransportError ||
    error instanceof UpstreamStatusError
  );
}

// ── Pool state, process-wide ────────────────────────────────────────────────

const POOL = "__maddie_proxy_pool__";

interface PoolState {
  signature: string;
  pool: ProxyHealth[];
  probingAt: number;
  dispatchers: Map<string, Dispatcher>;
  direct: Dispatcher | null;
}

type GlobalBag = typeof globalThis & { [POOL]?: PoolState };

function poolState(): PoolState {
  const config = getConfig();
  const signature = config.proxyPool.join("|");
  const bag = globalThis as GlobalBag;
  const existing = bag[POOL];
  if (existing && existing.signature === signature) return existing;

  const { usable, rejected } = parseProxyPool(config.proxyPool);
  for (const bad of rejected) {
    log.warn(`ignoring unsupported proxy ${bad.raw} — ProxyAgent speaks HTTP only`);
  }
  const created: PoolState = {
    signature,
    pool: usable.map((entry) => ({
      entry,
      latencyMs: null,
      restingUntil: 0,
      lastProbeAt: 0,
      lastError: null,
    })),
    probingAt: 0,
    dispatchers: new Map(),
    direct: null,
  };
  bag[POOL] = created;
  return created;
}

function dispatcherFor(entry: ProxyEntry | null, timeoutMs: number): Dispatcher {
  const state = poolState();
  if (entry === null) {
    if (state.direct === null) {
      state.direct = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs, connect: { timeout: 10_000 } });
    }
    return state.direct;
  }
  const cached = state.dispatchers.get(entry.url);
  if (cached) return cached;
  const created = new ProxyAgent({
    uri: entry.url,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
    connect: { timeout: 10_000 },
  });
  state.dispatchers.set(entry.url, created);
  return created;
}

/**
 * A transport failure — no HTTP answer was ever produced. `AbortError` is
 * excluded on purpose: that is OUR deadline, and resting a healthy proxy
 * because one upstream was slow empties the pool in a minute.
 */
export function isTransportFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "AbortError" || name === "TimeoutError") return false;
  const codes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EPIPE",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "UND_ERR_RESPONSE_STATUS_CODE",
    "CERT_HAS_EXPIRED",
  ]);
  const seen = new Set<unknown>();
  let cursor: unknown = error;
  while (cursor !== null && typeof cursor === "object" && !seen.has(cursor)) {
    seen.add(cursor);
    const code = "code" in cursor ? String((cursor as { code: unknown }).code) : "";
    if (codes.has(code)) return true;
    cursor = "cause" in cursor ? (cursor as { cause: unknown }).cause : null;
  }
  // undici surfaces every connect-level failure as a plain `fetch failed`.
  return name === "TypeError" && String((error as { message?: unknown }).message ?? "").includes("fetch failed");
}

// ── Probing ─────────────────────────────────────────────────────────────────

async function probeOne(health: ProxyHealth, probeUrl: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, 8_000));
  try {
    await undiciFetch(probeUrl, {
      method: "HEAD",
      dispatcher: dispatcherFor(health.entry, timeoutMs),
      signal: controller.signal,
      headers: { "user-agent": userAgent() },
    });
    // Any HTTP answer proves the tunnel works. The status is the destination's
    // opinion of a HEAD request and is none of our business here.
    health.latencyMs = Date.now() - started;
    health.restingUntil = 0;
    health.lastError = null;
  } catch (error) {
    health.latencyMs = null;
    health.lastError = error instanceof Error ? error.message : String(error);
    health.restingUntil = Date.now() + 60_000;
  } finally {
    clearTimeout(timer);
    health.lastProbeAt = Date.now();
  }
}

function maybeProbe(): void {
  const config = getConfig();
  const state = poolState();
  if (state.pool.length < 2) return; // nothing to rank
  const now = Date.now();
  if (now - state.probingAt < config.proxyProbeIntervalMs) return;
  state.probingAt = now;
  const probeUrl = config.proxyProbeUrl === "" ? "https://api.pdok.nl/" : config.proxyProbeUrl;
  void Promise.all(state.pool.map((health) => probeOne(health, probeUrl, config.upstreamTimeoutMs))).catch(() => {
    /* probing is best-effort; a failed probe is already recorded per proxy */
  });
}

export interface ProxyStatusReport {
  configured: number;
  usable: number;
  entries: Array<{ url: string; tier: 0 | 1; latencyMs: number | null; resting: boolean; lastError: string | null }>;
}

export function proxyStatus(): ProxyStatusReport {
  const state = poolState();
  const now = Date.now();
  return {
    configured: getConfig().proxyPool.length,
    usable: state.pool.length,
    entries: state.pool.map((health) => ({
      // Credentials, if any, never leave the process.
      url: health.entry.url.replace(/\/\/[^@]*@/, "//***@"),
      tier: health.entry.tier,
      latencyMs: health.latencyMs,
      resting: health.restingUntil > now,
      lastError: health.lastError,
    })),
  };
}

export function userAgent(): string {
  const config = getConfig();
  const contact = config.nominatimContactEmail !== "" ? ` (${config.nominatimContactEmail})` : "";
  return `Maddie/1.0 safety-intelligence${contact}`;
}

// ── The fetch itself ────────────────────────────────────────────────────────

export interface UpstreamRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Force a direct connection (the AI tier, which defaults to no proxy). */
  direct?: boolean;
  signal?: AbortSignal;
}

export interface UpstreamResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  /** Which route answered, for the diagnostics surfaces. */
  via: string;
}

/**
 * Fetches `url`, choosing a route by the rules in §6, and failing over ONLY on
 * transport failures. An HTTP error is the destination's answer — asking a
 * different proxy the same question gets the same answer, more slowly.
 */
export async function upstreamFetch(url: string, request: UpstreamRequest = {}): Promise<UpstreamResponse> {
  const config = getConfig();
  const timeoutMs = request.timeoutMs ?? config.upstreamTimeoutMs;
  const target = new URL(url);

  const routes: Array<ProxyHealth | null> = [];
  if (request.direct === true || !shouldProxy(target.hostname, config.proxyBypass)) {
    routes.push(null);
  } else {
    maybeProbe();
    const ranked = rankProxies(poolState().pool);
    routes.push(...ranked);
    // With no proxy configured at all, direct is the only route. With proxies
    // configured, direct is still worth a final try: on a box with open egress
    // the pool is decoration, and refusing to try direct turns that into an
    // outage.
    routes.push(null);
  }

  const attempted: string[] = [];
  let lastTransportError: unknown = null;

  for (const route of routes) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const via = route === null ? "direct" : route.entry.url;
    attempted.push(via);

    try {
      const response = await undiciFetch(url, {
        method: request.method ?? "GET",
        headers: { "user-agent": userAgent(), ...(request.headers ?? {}) },
        body: request.body,
        dispatcher: dispatcherFor(route?.entry ?? null, timeoutMs),
        signal: controller.signal,
      });
      const text = await response.text();
      if (route !== null) {
        route.latencyMs = route.latencyMs ?? 0;
        route.restingUntil = 0;
        route.lastError = null;
      }
      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers as unknown as Headers,
        text,
        via,
      };
    } catch (error) {
      if (timedOut || request.signal?.aborted === true) {
        // Our deadline, not the route's fault. Do not rest it.
        throw new UpstreamTimeoutError(url, timeoutMs);
      }
      if (!isTransportFailure(error)) throw error;
      lastTransportError = error;
      if (route !== null) {
        route.restingUntil = Date.now() + 60_000;
        route.lastError = error instanceof Error ? error.message : String(error);
        log.warn(`resting proxy ${route.entry.url} after a transport failure`, route.lastError);
      }
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
    }
  }

  throw new UpstreamTransportError(url, attempted, lastTransportError);
}

/**
 * The same routing, for binary bodies: map tiles and street imagery. Kept
 * separate so the text path never has to guess at an encoding.
 */
export async function upstreamBytes(
  url: string,
  request: UpstreamRequest = {},
): Promise<{ status: number; ok: boolean; headers: Headers; bytes: Uint8Array; via: string }> {
  const config = getConfig();
  const timeoutMs = request.timeoutMs ?? config.upstreamTimeoutMs;
  const target = new URL(url);

  const routes: Array<ProxyHealth | null> = [];
  if (request.direct === true || !shouldProxy(target.hostname, config.proxyBypass)) {
    routes.push(null);
  } else {
    maybeProbe();
    routes.push(...rankProxies(poolState().pool), null);
  }

  const attempted: string[] = [];
  let lastTransportError: unknown = null;

  for (const route of routes) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const via = route === null ? "direct" : route.entry.url;
    attempted.push(via);
    try {
      const response = await undiciFetch(url, {
        method: request.method ?? "GET",
        headers: { "user-agent": userAgent(), ...(request.headers ?? {}) },
        body: request.body,
        dispatcher: dispatcherFor(route?.entry ?? null, timeoutMs),
        signal: controller.signal,
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { status: response.status, ok: response.ok, headers: response.headers as unknown as Headers, bytes, via };
    } catch (error) {
      if (timedOut) throw new UpstreamTimeoutError(url, timeoutMs);
      if (!isTransportFailure(error)) throw error;
      lastTransportError = error;
      if (route !== null) route.restingUntil = Date.now() + 60_000;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new UpstreamTransportError(url, attempted, lastTransportError);
}

/** `upstreamFetch` plus JSON parsing. Non-2xx becomes UpstreamStatusError. */
export async function upstreamJson<T = unknown>(url: string, request: UpstreamRequest = {}): Promise<T> {
  const response = await upstreamFetch(url, {
    ...request,
    headers: { accept: "application/json", ...(request.headers ?? {}) },
  });
  if (!response.ok) {
    throw new UpstreamStatusError(url, response.status, response.text.slice(0, 500));
  }
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new UpstreamStatusError(url, response.status, `unparseable JSON: ${response.text.slice(0, 200)}`);
  }
}
