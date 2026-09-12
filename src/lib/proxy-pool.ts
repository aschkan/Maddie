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

import { isEntryFailure, openTunnel, parseHop, parseHopList, requestThrough, type Hop } from "./proxy-chain.ts";

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

/** What is known about the entry proxy, which is checked on its own. */
export interface EntryState {
  /** null until it has been checked. */
  ok: boolean | null;
  lastError: string | null;
  lastCheck: number;
  latencyMs: number | null;
}

export class ProxyPool {
  entry: Hop | null;
  entryState: EntryState;
  states: HopState[];
  probeUrl: string;
  timeoutMs: number;
  probeTimeoutMs: number;
  entryTimeoutMs: number;
  maxAttempts: number;
  budgetMs: number;
  sweeping: boolean;
  swept: number;
  lastSweep: number;
  private timer: NodeJS.Timeout | null;

  constructor() {
    this.entry = parseHop(process.env.OSM_PROXY_ENTRY ?? "");
    this.entryState = { ok: null, lastError: null, lastCheck: 0, latencyMs: null };
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
    // The entry is a LAN address: it answers at once or it is not there.
    this.entryTimeoutMs = envNumber("OSM_PROXY_ENTRY_TIMEOUT_MS", 4_000);
    this.maxAttempts = Math.max(1, envNumber("OSM_PROXY_ATTEMPTS", 4));
    /*
     * A ceiling on ONE request, across all its attempts.
     *
     * Four attempts at a 25s timeout is a hundred seconds, and a page that
     * hangs for a hundred seconds has already failed — the browser shows a
     * pending request and the person reloads. Better to give up and say why.
     */
    this.budgetMs = envNumber("OSM_PROXY_BUDGET_MS", 45_000);
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

  /**
   * Is the entry proxy even there? One plain TCP connect, nothing else.
   *
   * This exists because the answer used to be buried. With the entry down,
   * every one of 649 hops failed with the same sentence — "no TCP connection
   * to 192.168.11.165:2000" — and the status page reported `working: 0` and
   * eight identical sample failures, which reads as "the proxy list is dead"
   * when the list was never tried. One connect, up front, names the machine
   * that is actually unreachable.
   *
   * Short timeout: this is a LAN address. Either it answers immediately or it
   * is not there.
   */
  async checkEntry(): Promise<boolean> {
    if (!this.entry) {
      this.entryState = { ok: null, lastError: null, lastCheck: Date.now(), latencyMs: null };
      return true;
    }
    const started = Date.now();
    try {
      const socket = await openTunnel(this.entry.host, this.entry.port, {
        entry: null, hop: null, timeoutMs: this.entryTimeoutMs,
      });
      socket.destroy();
      this.entryState = { ok: true, lastError: null, lastCheck: started, latencyMs: Date.now() - started };
      return true;
    } catch (error) {
      this.entryState = {
        ok: false,
        lastError: (error instanceof Error ? error.message : "failed").slice(0, 200),
        lastCheck: started,
        latencyMs: null,
      };
      return false;
    }
  }

  /**
   * The entry to actually use for a request.
   *
   * Null once the entry has been found unreachable, which means the hops are
   * tried DIRECTLY instead. The entry exists because the exits are assumed to
   * be reachable only through it — but that is an assumption, and enforcing it
   * against a dead entry turns a list of 649 proxies into a list of zero. If
   * some of them can be reached from here without it, the chain still works;
   * if none can, the attempts fail as they would have anyway.
   */
  entryFor(): Hop | null {
    return this.entryState.ok === false ? null : this.entry;
  }

  get bypassingEntry(): boolean {
    return this.entry !== null && this.entryState.ok === false;
  }

  /** One probe: the real chain, to a real upstream. */
  async probe(state: HopState): Promise<void> {
    state.lastProbe = Date.now();
    try {
      const response = await requestThrough(this.probeUrl, {
        entry: this.entryFor(),
        hop: state.hop,
        timeoutMs: this.probeTimeoutMs,
        headers: { "User-Agent": USER_AGENT },
      });
      if (response.status >= 200 && response.status < 400) this.succeeded(state, response.ms);
      else this.failed(state, `probe answered ${response.status}`);
    } catch (error) {
      /*
       * An entry failure is NOT this hop's fault — it was never contacted.
       * Marking it bad here is what blacklisted the whole list and left 536 of
       * them resting for a fault they had no part in.
       */
      if (isEntryFailure(error)) {
        this.entryState.ok = false;
        this.entryState.lastError = (error instanceof Error ? error.message : "failed").slice(0, 200);
        return;
      }
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

    /*
     * The entry first, once.
     *
     * Sweeping 649 hops through an entry that is not answering costs 649
     * timeouts and teaches nothing — and used to mark all of them dead. If it
     * is down, `entryFor()` now returns null and the sweep goes on WITHOUT it,
     * which is the only way the provided list gets tried at all.
     */
    await this.checkEntry();

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
    const deadline = Date.now() + this.budgetMs;

    for (let n = 0; n < this.maxAttempts; n++) {
      if (Date.now() >= deadline) {
        reasons.push(`gave up after ${this.budgetMs}ms`);
        break;
      }
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
        const reason = error instanceof Error ? error.message : "failed";
        /*
         * Unless it was the ENTRY that could not be reached, in which case
         * this hop was never contacted and every remaining one will fail the
         * same way. Stop, rather than spending the whole budget rediscovering
         * that the LAN proxy is down 649 times.
         */
        if (isEntryFailure(error)) {
          this.entryState.ok = false;
          this.entryState.lastError = reason.slice(0, 200);
          reasons.push(`entry ${this.entry?.label ?? ""}: ${reason}`);
          state.inFlight = false;
          break;
        }
        // Nothing came back at all: that IS the hop.
        this.failed(state, reason);
        reasons.push(`${state.hop.label}: ${reason}`);
      } finally {
        state.inFlight = false;
      }
    }

    return { ok: false, tried, reasons };
  }

  /**
   * The one sentence worth reading, or null when nothing is obviously wrong.
   *
   * The status page used to answer with `working: 0` and eight identical
   * failures, and working out that they all named the same LAN address was
   * left to whoever was reading. This says it.
   */
  problem(): string | null {
    if (this.entry && this.entryState.ok === false) {
      return (
        `The entry proxy ${this.entry.label} cannot be reached from this server ` +
        `(${this.entryState.lastError ?? "no connection"}). ` +
        `Every exit is being tried directly instead — check that this machine is on the same ` +
        `network as ${this.entry.host}, and that something is listening on port ${this.entry.port}.`
      );
    }
    if (this.states.length === 0 && !this.entry) {
      return "No proxies are configured. This server is fetching OpenStreetMap directly.";
    }
    if (this.states.length > 0 && this.states.every((state) => state.ok === false)) {
      return "Every proxy in the list has failed. Nothing here can reach OpenStreetMap.";
    }
    return null;
  }

  summary(): {
    entry: string | null;
    entryOk: boolean | null;
    entryError: string | null;
    bypassingEntry: boolean;
    problem: string | null;
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
      // Checked on its own, so "the entry is down" is never inferred from 649
      // identical hop failures.
      entryOk: this.entryState.ok,
      entryError: this.entryState.lastError,
      bypassingEntry: this.bypassingEntry,
      problem: this.problem(),
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
