/**
 * Which proxies actually work, and which one to use next. SERVER ONLY.
 *
 * The list is 649 scraped public proxies. Most of them are dead, most of the
 * rest cannot be reached from this network at all, and the metadata that came
 * with them is not worth reading — every entry claims `https: false`, which if
 * believed would mean not one can tunnel. So nothing here trusts the list: it
 * probes each hop by doing the real thing, through the real chain, to a real
 * upstream, and sorts by what came back.
 *
 * Three behaviours, and they are separate on purpose:
 *
 *   PROBE     in the background, so a visitor never waits for a dead proxy to
 *             time out just to discover it is dead.
 *   RANK      working first, fastest first within that. A hop that has just
 *             failed rests, for longer each consecutive time, because the
 *             thing that makes this slow is retrying dead entries.
 *   ROTATE    within ONE request. A long route is one big Overpass query, and
 *             when the exit it went out through is rate limited the answer is
 *             to ask again from somewhere else rather than to fail the page.
 *
 * On rotation and rate limits, plainly: this exists because the network this
 * runs on cannot reach OpenStreetMap at all, and a different exit is the only
 * way to get an answer. It is not a way to take more from Overpass than they
 * offer — `MAX_ATTEMPTS` is small, requests are serialised, and the real fix is
 * still to self-host Overpass, which removes the limit and the reachability
 * problem together. See the README.
 */

import fs from "node:fs";
import path from "node:path";

import { parseHop, parseHopList, requestThrough, type Hop } from "./proxy-chain.ts";

export interface HopState {
  hop: Hop;
  /** null until it has been probed. */
  ok: boolean | null;
  latencyMs: number | null;
  lastProbe: number;
  lastError: string | null;
  /** Consecutive failures, which is what the cooldown grows on. */
  failures: number;
  restingUntil: number;
  inFlight: boolean;
  successes: number;
}

/**
 * How long a hop rests after failing, by consecutive failure count.
 *
 * Grows fast. Retrying a dead entry is the single biggest cost here: with 649
 * of them and a 20-second timeout apiece, a flat cooldown means every request
 * spends its whole budget rediscovering the same corpses.
 */
/**
 * How long a hop steps aside after the upstream rate limited it.
 *
 * Short and flat: the proxy is fine, the window just has to roll.
 */
export const LIMIT_REST_MS = 60_000;

/**
 * Why an attempt did not produce an answer.
 *
 *   hop      nothing came back through this proxy — its fault, rest it properly
 *   limit    the upstream rate limited this exit IP — step aside briefly
 *   upstream the upstream said no to everyone — not this proxy's fault at all
 */
export type Attempt<T> =
  | { done: true; value: T }
  | { done: false; reason: string; fault: "hop" | "limit" | "upstream" };

export function cooldownMs(failures: number): number {
  const ladder = [30_000, 60_000, 180_000, 600_000, 1_800_000];
  return ladder[Math.min(failures, ladder.length) - 1] ?? ladder[0] ?? 30_000;
}

/**
 * Best first: known-good and not resting, fastest first; then never-probed;
 * then anything else whose rest has expired.
 *
 * Never-probed comes before known-bad but after known-good, which is what makes
 * a cold start usable — the first request does not have to wait for the sweep
 * to finish, it just tries unproven hops after the proven ones.
 */
export function rank(states: readonly HopState[], now: number): HopState[] {
  const available = states.filter((state) => !state.inFlight && state.restingUntil <= now);
  const tier = (state: HopState): number => (state.ok === true ? 0 : state.ok === null ? 1 : 2);
  return [...available].sort((a, b) => {
    const byTier = tier(a) - tier(b);
    if (byTier !== 0) return byTier;
    const aLatency = a.latencyMs ?? Number.MAX_SAFE_INTEGER;
    const bLatency = b.latencyMs ?? Number.MAX_SAFE_INTEGER;
    if (aLatency !== bLatency) return aLatency - bLatency;
    return a.hop.label.localeCompare(b.hop.label);
  });
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Read the list from a file if one is named, else from the env variable. */
export function loadHops(): Hop[] {
  const inline = process.env.OSM_PROXY_LIST?.trim();
  if (inline) return parseHopList(inline);

  const file = process.env.OSM_PROXY_LIST_FILE?.trim() || "proxies.json";
  const full = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  try {
    return parseHopList(fs.readFileSync(full, "utf8"));
  } catch {
    return [];
  }
}

export class ProxyPool {
  entry: Hop | null;
  states: HopState[];
  probeUrl: string;
  timeoutMs: number;
  probeTimeoutMs: number;
  maxAttempts: number;
  sweeping: boolean;
  swept: number;
  lastSweep: number;
  private timer: NodeJS.Timeout | null;

  constructor() {
    this.entry = parseHop(process.env.OSM_PROXY_ENTRY ?? "");
    this.states = loadHops().map((hop) => ({
      hop, ok: null, latencyMs: null, lastProbe: 0, lastError: null,
      failures: 0, restingUntil: 0, inFlight: false, successes: 0,
    }));
    // The probe hits an upstream this app actually depends on, not a neutral
    // connectivity endpoint: a proxy that reaches one and not the other is
    // useless here, and `/api/status` is the cheapest thing Overpass serves.
    this.probeUrl = process.env.OSM_PROXY_PROBE_URL?.trim() || "https://overpass-api.de/api/status";
    this.timeoutMs = envNumber("OSM_PROXY_TIMEOUT_MS", 25_000);
    // Shorter than a real request: a probe exists to find dead entries fast.
    this.probeTimeoutMs = envNumber("OSM_PROXY_PROBE_TIMEOUT_MS", 9_000);
    this.maxAttempts = Math.max(1, envNumber("OSM_PROXY_ATTEMPTS", 4));
    this.sweeping = false;
    this.swept = 0;
    this.lastSweep = 0;
    this.timer = null;
  }

  get configured(): boolean {
    return this.states.length > 0 || this.entry !== null;
  }

  find(label: string): HopState | undefined {
    return this.states.find((state) => state.hop.label === label);
  }

  succeeded(state: HopState, ms: number): void {
    state.ok = true;
    state.latencyMs = state.latencyMs === null ? ms : Math.round(state.latencyMs * 0.7 + ms * 0.3);
    state.failures = 0;
    state.restingUntil = 0;
    state.lastError = null;
    state.successes += 1;
  }

  /**
   * The hop itself is at fault: nothing came back through it.
   *
   * Only a TRANSPORT failure belongs here — a refused CONNECT, a timeout, a
   * dead socket. It marks the hop bad and rests it for longer each time.
   */
  failed(state: HopState, reason: string): void {
    state.ok = false;
    state.failures += 1;
    state.lastError = reason.slice(0, 200);
    state.restingUntil = Date.now() + cooldownMs(state.failures);
  }

  /**
   * The exit is fine; the upstream is rate limiting THIS IP.
   *
   * A short rest and no black mark: the proxy did its job, and it will be
   * usable again as soon as the window rolls. Running it through `failed`
   * would climb the cooldown ladder and eventually retire a working proxy for
   * half an hour because Overpass was busy.
   */
  limited(state: HopState, reason: string): void {
    state.lastError = reason.slice(0, 200);
    state.restingUntil = Date.now() + LIMIT_REST_MS;
  }

  /** One probe: the real chain, to a real upstream. */
  async probe(state: HopState): Promise<void> {
    state.lastProbe = Date.now();
    try {
      const response = await requestThrough(this.probeUrl, {
        entry: this.entry,
        hop: state.hop,
        timeoutMs: this.probeTimeoutMs,
        headers: { "User-Agent": USER_AGENT },
      });
      if (response.status >= 200 && response.status < 400) this.succeeded(state, response.ms);
      else this.failed(state, `probe answered ${response.status}`);
    } catch (error) {
      this.failed(state, error instanceof Error ? error.message : "probe failed");
    }
  }

  /**
   * Probe everything, a few at a time.
   *
   * Bounded concurrency because the entry proxy is one box on a LAN and 649
   * simultaneous CONNECTs is a denial of service against the thing this whole
   * chain depends on.
   */
  async sweep(concurrency = envNumber("OSM_PROXY_PROBE_CONCURRENCY", 12)): Promise<void> {
    if (this.sweeping || this.states.length === 0) return;
    this.sweeping = true;
    this.swept = 0;

    // Known-good first, so a sweep that is interrupted has still refreshed the
    // hops the app is actually using.
    const order = [...this.states].sort((a, b) => (a.ok === true ? 0 : 1) - (b.ok === true ? 0 : 1));
    let next = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = next++;
        const state = order[index];
        if (!state) return;
        // A hop that is resting has failed recently; the cooldown is there so
        // it is not retried, and a sweep must not walk straight through it.
        if (state.restingUntil > Date.now()) { this.swept += 1; continue; }
        await this.probe(state);
        this.swept += 1;
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
    } finally {
      this.sweeping = false;
      this.lastSweep = Date.now();
    }
  }

  /** Start the background sweeps. Safe to call repeatedly. */
  start(): void {
    if (this.timer || this.states.length === 0) return;
    void this.sweep();
    const interval = envNumber("OSM_PROXY_PROBE_INTERVAL_MS", 600_000);
    this.timer = setInterval(() => { void this.sweep(); }, interval);
    // Never hold the process open for a probe timer.
    this.timer.unref?.();
  }

  /**
   * Run a request through the chain, moving to another exit when one fails.
   *
   * `attempt` gets a hop and returns either a result or a reason to rotate. A
   * rate limit, a gateway timeout and a dead tunnel are all reasons to rotate;
   * a 400 is not — the query is wrong and asking a different proxy the same
   * wrong question wastes a slot on every proxy in turn.
   */
  async rotate<T>(
    attempt: (state: HopState) => Promise<Attempt<T>>,
  ): Promise<{ ok: true; value: T; via: string; attempts: number } | { ok: false; tried: string[]; reasons: string[] }> {
    const tried: string[] = [];
    const reasons: string[] = [];
    // Hops already used for THIS request. An upstream that says no through one
    // exit will say no through it again; that is not a reason to think less of
    // the exit.
    const used = new Set<string>();

    for (let n = 0; n < this.maxAttempts; n++) {
      const state = rank(this.states, Date.now()).find((candidate) => !used.has(candidate.hop.label));
      if (!state) break;

      used.add(state.hop.label);
      state.inFlight = true;
      tried.push(state.hop.label);
      try {
        const started = Date.now();
        const outcome = await attempt(state);
        if (outcome.done) {
          this.succeeded(state, Date.now() - started);
          return { ok: true, value: outcome.value, via: state.hop.label, attempts: n + 1 };
        }
        /*
         * Who is at fault decides what happens to the hop, and getting this
         * wrong is expensive in both directions.
         *
         * A 403 or a 502 from OpenStreetMap says nothing about the proxy that
         * carried it. Retiring the hop for that emptied the whole pool the
         * first time an upstream was unreachable — every exit marked dead
         * because the destination was down.
         */
        if (outcome.fault === "hop") this.failed(state, outcome.reason);
        else if (outcome.fault === "limit") this.limited(state, outcome.reason);
        reasons.push(`${state.hop.label}: ${outcome.reason}`);
      } catch (error) {
        // Nothing came back at all: that IS the hop.
        const reason = error instanceof Error ? error.message : "failed";
        this.failed(state, reason);
        reasons.push(`${state.hop.label}: ${reason}`);
      } finally {
        state.inFlight = false;
      }
    }

    return { ok: false, tried, reasons };
  }

  summary(): {
    entry: string | null;
    total: number;
    working: number;
    untested: number;
    resting: number;
    sweeping: boolean;
    swept: number;
    lastSweep: number;
    best: { proxy: string; latencyMs: number | null; successes: number }[];
  } {
    const now = Date.now();
    return {
      entry: this.entry?.label ?? null,
      total: this.states.length,
      working: this.states.filter((state) => state.ok === true).length,
      untested: this.states.filter((state) => state.ok === null).length,
      resting: this.states.filter((state) => state.restingUntil > now).length,
      sweeping: this.sweeping,
      swept: this.swept,
      lastSweep: this.lastSweep,
      best: rank(this.states, now)
        .filter((state) => state.ok === true)
        .slice(0, 12)
        .map((state) => ({
          proxy: state.hop.label,
          latencyMs: state.latencyMs,
          successes: state.successes,
        })),
    };
  }
}

/**
 * Identify the app to the services it queries.
 *
 * Both Overpass and Nominatim ask for this, and Nominatim blocks a
 * default-User-Agent client outright. Going out through a rotating exit makes
 * this more important rather than less: it is the only thing that says these
 * requests are one small app rather than an anonymous scraper.
 */
export const USER_AGENT =
  process.env.OSM_USER_AGENT?.trim() ||
  "Maddie/1.0 (route safety map; https://github.com/aschkan/Maddie)";

export const ALLOW_DIRECT = envFlag("OSM_PROXY_ALLOW_DIRECT");

/**
 * One pool per server process, cached across Next's module reloads — a fresh
 * pool per edit would restart the sweep and throw away everything learned.
 */
const cache = globalThis as unknown as { __maddieProxyPool?: ProxyPool };

export function pool(): ProxyPool {
  if (!cache.__maddieProxyPool) {
    cache.__maddieProxyPool = new ProxyPool();
    cache.__maddieProxyPool.start();
  }
  return cache.__maddieProxyPool;
}
