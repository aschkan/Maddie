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
import { mergeProxyLists, sources, toRecords } from "./proxy-sources.ts";

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
 *
 * A hop already carrying another request is skipped, which is what hands the
 * parallel chunks of one route read a DIFFERENT exit each — the whole point of
 * splitting them, since the limit being worked around is per exit IP.
 * `includeInFlight` relaxes that, and `rotate` uses it only as a last resort:
 * with more chunks in the air than working exits, sharing one is worse than a
 * chunk that fails outright for want of a proxy to try.
 */
export function rank(
  states: readonly HopState[],
  now: number,
  options: { includeInFlight?: boolean } = {},
): HopState[] {
  const available = states.filter(
    (state) => (options.includeInFlight === true || !state.inFlight) && state.restingUntil <= now,
  );
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

/* ───────────────────────── the dials, hardcoded ─────────────────────────────
 *
 * There is not one `process.env` read left in this file, and that is the point.
 * This app answers from TWO machines with different egress, and every one of
 * these numbers used to be settable per box — so "why is the other server
 * slower" had eleven possible answers, none of them in the repository. pm2
 * replays a saved environment on top of that (see CLAUDE.md), so a variable
 * edited in `.env` and a variable the process is actually running can disagree
 * indefinitely. One file, read the same way on both boxes, is the whole fix.
 *
 * Change a number here and both servers change together, on the next build.
 */

/**
 * A first proxy that every hop is reached THROUGH, or null for none.
 *
 * Null is the normal arrangement and always was. An entry proxy is only for a
 * network where the exits are reachable solely through another box, and naming
 * a specific LAN address here as though it were the default is how every
 * example, the scraper's help text and the failure message came to point at a
 * machine that no longer existed. The machinery below still handles one — set
 * this to `"10.0.0.1:3128"` and the chain becomes two CONNECTs again.
 */
export const ENTRY_PROXY: string | null = null;

/**
 * What a probe fetches.
 *
 * An upstream this app actually depends on, not a neutral connectivity check: a
 * proxy that reaches `api.ipify.org` and not Overpass is useless here, and two
 * of the failures in a real list were proxies intercepting TLS — which an ipify
 * check over the same intercepted connection is perfectly happy with.
 * `/api/status` is the cheapest thing Overpass serves.
 */
export const PROBE_URL = "https://overpass-api.de/api/status";

/** A real request through the chain. */
export const REQUEST_TIMEOUT_MS = 25_000;
/** Shorter: a probe exists to find dead entries fast. */
export const PROBE_TIMEOUT_MS = 9_000;
/** Shorter still: the entry is one hop away and answers at once or is not there. */
export const ENTRY_TIMEOUT_MS = 4_000;
/** Shortest: a scraped candidate is dead until proven otherwise, and there are hundreds. */
export const SCRAPE_PROBE_TIMEOUT_MS = 6_000;

/** How many exits ONE request may try before giving up. */
export const MAX_ATTEMPTS = 4;

/**
 * How long a request will wait for a busy exit before giving up on one.
 *
 * Short. This covers "every good exit is mid-request for a moment", which is
 * ordinary when a route read is split into pieces. It is not a queue: if
 * nothing frees up in five seconds the pool is genuinely oversubscribed and
 * failing is a better answer than a page that hangs.
 */
export const BUSY_WAIT_MS = 5_000;

/**
 * A ceiling on ONE request, across all its attempts.
 *
 * Four attempts at a 25s timeout is a hundred seconds, and a page that hangs
 * for a hundred seconds has already failed — the browser shows a pending
 * request and the person reloads. Better to give up and say why.
 */
export const BUDGET_MS = 45_000;

/**
 * Below this many working exits, go and look for more.
 *
 * Eight rather than three, because a route read goes out as several pieces in
 * parallel and each piece may rotate through several exits — see `piecesFor`
 * in `overpass.ts`. The split sizes itself down when the pool is thin, so a
 * shortage degrades rather than failing; this is the number that decides when
 * to stop degrading and go and find more.
 *
 * A live box sat at four working exits with nineteen resting after rate
 * limits. That is what "short" looks like, and it is well under this.
 */
export const MIN_WORKING = 24;

/**
 * How long between scrapes when the pool is merely below target.
 *
 * These lists refresh on the order of hours, so going back sooner mostly
 * re-probes addresses already known to be dead.
 */
export const SCRAPE_INTERVAL_MS = 3_600_000;

/**
 * How long between scrapes when the pool is actually STARVING.
 *
 * Below `STARVING`, an hour is far too long to wait: the page is failing reads
 * now. The lists will not have changed much, but the addresses this box has
 * not yet tried from them have not changed either — a round only ever probes a
 * bounded bite of what it downloads, so going back sooner does find new ones.
 */
export const HUNGRY_SCRAPE_INTERVAL_MS = 300_000;

/** Below this many working exits, the pool is starving rather than thin. */
export const STARVING = 6;

/**
 * How many requests may go out DIRECTLY at the same time.
 *
 * Direct is ONE exit — this server's own IP — however many proxies the pool
 * has. The forwarder tries it first whenever it works, so without a cap every
 * piece of a parallel route read leaves from that one address at once, which
 * is the per-IP limit the split exists to get under. Two, because that is
 * roughly what Overpass hands out per IP; the rest of the pieces go straight
 * to a proxy instead of queueing behind it.
 */
export const DIRECT_CONCURRENCY = 2;
/**
 * How many fresh addresses to try per round.
 *
 * Large, because the yield is small. Of a few hundred scraped public proxies a
 * handful answer Overpass, and a long route split many ways wants dozens of
 * working exits at once — so the round has to be big enough that "a handful"
 * is still a useful number.
 */
export const SCRAPE_MAX = 1_500;

/**
 * A ceiling on the states held in memory.
 *
 * Only the ones that ANSWERED are kept after a scrape, so this is a bound on
 * proxies that have worked at least once, not on addresses tried.
 */
export const MAX_STATES = 2_000;

/** How many probes at once during a normal sweep. */
export const PROBE_CONCURRENCY = 40;
/**
 * How many at once when probing a freshly scraped batch.
 *
 * Higher than a sweep on purpose: these are hundreds of addresses that are
 * almost all dead, each costing a full timeout to establish that, and they are
 * hundreds of DIFFERENT hosts rather than a queue at one entry proxy. Doing
 * them twenty-four at a time took minutes; this is the "scan them fast" half
 * of the requirement.
 */
export const SCRAPE_CONCURRENCY = 150;

/** How often the background sweep re-probes everything. */
export const SWEEP_INTERVAL_MS = 600_000;

/**
 * The committed seed list, shared by both servers.
 *
 * Joined from a literal below rather than from a variable: Next traces
 * filesystem access statically, and a `path.join` whose tail it cannot see
 * makes it bundle the whole project — every source file and the public folder —
 * into the server output.
 */
export function seedFile(): string {
  return path.join(process.cwd(), "proxies.json");
}

/**
 * Whether a request may go out with NO proxy after every exit has failed.
 *
 * Not a constant, and not a variable either — the pool already knows. It is
 * `directWorks`: try direct again at the end only on the machine where direct
 * has been probed and works, and never on the one where it is a guaranteed
 * timeout at the end of every failed request.
 *
 * This was briefly a hardcoded `false`, on the reasoning that the forwarder
 * already tries direct FIRST when `directWorks`, so a second attempt is a
 * retry of something that just failed. That reasoning is wrong in the case
 * that matters: the first attempt used ONE mirror, and the retry uses the next
 * one. With an empty pool — which is the normal state of a list of public
 * proxies — that second mirror is the only thing standing between a transient
 * refusal and a failed read.
 */
export function allowDirectFallback(proxies: ProxyPool): boolean {
  return proxies.directWorks;
}

/**
 * Identify the app to the services it queries.
 *
 * Both Overpass and Nominatim ask for this, and Nominatim blocks a
 * default-User-Agent client outright. Going out through a rotating exit makes
 * this more important rather than less: it is the only thing that says these
 * requests are one small app rather than an anonymous scraper.
 */
export const USER_AGENT = "Maddie/1.0 (route safety map; https://github.com/aschkan/Maddie)";

/**
 * Where THIS machine keeps the proxies it has found to work.
 *
 * Not `proxies.json`, which is committed and therefore the same file on both
 * servers. The two machines this app answers from have different egress —
 * that is the whole reason any of this exists — so a proxy proven from one is
 * not evidence about the other, and a shared file would have them overwriting
 * each other's findings. `.data/` is gitignored and per checkout.
 */
export function learnedFile(): string {
  return path.join(process.cwd(), ".data", "proxies.json");
}

function readList(file: string): Hop[] {
  try {
    return parseHopList(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/**
 * The list to start from: what this machine learned, then the committed seed.
 *
 * Learned first, because it has been proven here and the seed has only been
 * proven somewhere. Duplicates collapse on the label.
 *
 * The two files are parameters rather than variables so this stays testable
 * without an environment — that is the seam the env reads used to provide, and
 * a pure function is a better one.
 */
export function loadHops(files: { learned?: string; seed?: string } = {}): Hop[] {
  const learned = files.learned ?? learnedFile();
  const seed = files.seed ?? seedFile();

  const merged = [...readList(learned), ...readList(seed)];
  const seen = new Set<string>();
  return merged.filter((hop) => (seen.has(hop.label) ? false : (seen.add(hop.label), true)));
}

/** What is known about one link, checked on its own rather than inferred. */
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
  /**
   * Where `save()` writes what worked. A field rather than a lookup so a test
   * can point it at a temporary directory without an environment variable.
   */
  stateFile: string;
  /**
   * Whether this server can reach OpenStreetMap with no proxy at all.
   *
   * The two machines this is deployed on differ in exactly this, and it is
   * worth knowing rather than assuming in either direction: the one that can
   * get out should not be sending every tile through a stranger's proxy, and
   * the one that cannot should not be spending a timeout per request finding
   * that out again.
   */
  directState: EntryState;
  states: HopState[];
  probeUrl: string;
  timeoutMs: number;
  probeTimeoutMs: number;
  entryTimeoutMs: number;
  maxAttempts: number;
  budgetMs: number;
  /** Scraping state, so the status page can say when it last went looking. */
  scraping: boolean;
  lastScrape: number;
  lastScrapeError: string | null;
  lastScrapeAdded: number;
  minWorking: number;
  scrapeIntervalMs: number;
  scrapeMax: number;
  scrapeProbeTimeoutMs: number;
  maxStates: number;
  sweeping: boolean;
  swept: number;
  lastSweep: number;
  /** Which mirror the next request starts on. See `mirrorTurn()`. */
  private mirror: number;
  /** How many requests are going out directly right now. See `takeDirect()`. */
  private directBusy: number;
  private timer: NodeJS.Timeout | null;

  constructor() {
    this.entry = parseHop(ENTRY_PROXY ?? "");
    this.stateFile = learnedFile();
    this.entryState = { ok: null, lastError: null, lastCheck: 0, latencyMs: null };
    this.directState = { ok: null, lastError: null, lastCheck: 0, latencyMs: null };
    this.states = loadHops().map((hop) => ({
      hop, ok: null, latencyMs: null, lastProbe: 0, lastError: null,
      failures: 0, restingUntil: 0, inFlight: false, successes: 0,
    }));
    // Every one of these is a constant at the top of this file. See the block
    // there for why none of them is settable per machine any more.
    this.probeUrl = PROBE_URL;
    this.timeoutMs = REQUEST_TIMEOUT_MS;
    this.probeTimeoutMs = PROBE_TIMEOUT_MS;
    this.entryTimeoutMs = ENTRY_TIMEOUT_MS;
    this.maxAttempts = MAX_ATTEMPTS;
    this.budgetMs = BUDGET_MS;

    this.scraping = false;
    this.lastScrape = 0;
    this.lastScrapeError = null;
    this.lastScrapeAdded = 0;
    this.minWorking = MIN_WORKING;
    this.scrapeIntervalMs = SCRAPE_INTERVAL_MS;
    this.scrapeMax = SCRAPE_MAX;
    this.scrapeProbeTimeoutMs = SCRAPE_PROBE_TIMEOUT_MS;
    this.maxStates = MAX_STATES;
    this.sweeping = false;
    this.swept = 0;
    this.lastSweep = 0;
    this.mirror = 0;
    this.directBusy = 0;
    this.timer = null;
  }

  /**
   * A different upstream mirror for each request that asks.
   *
   * This exists because of a bug that the parallel route read introduced and
   * that took a screenshot to see: the four pieces of a route all went out
   * DIRECTLY, and the direct path always used mirror 0. So four simultaneous
   * queries arrived at `overpass-api.de` from one IP — which is exactly the
   * "parallel queries earn a 429" failure the old single-query design existed
   * to avoid. Two pieces came back, two were refused, and the page showed a
   * confident score above a red error.
   *
   * The limit is per IP PER HOST, so spreading concurrent requests across the
   * mirrors is what makes the split safe when there is only one IP to go out
   * from. `upstreamUrl` takes this as its attempt index and wraps, so it can
   * only ever select from the fixed table — a number from here can no more
   * name an upstream than a number from the request could.
   */
  mirrorTurn(): number {
    const turn = this.mirror;
    // Wrapped well below `Number.MAX_SAFE_INTEGER`; the modulo in
    // `upstreamUrl` does the real selection.
    this.mirror = (this.mirror + 1) % 1_000_000;
    return turn;
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
   * to the LAN entry proxy" — and the status page reported `working: 0` and
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
   * Can this server just fetch it? One probe, no proxy in the way.
   *
   * Run on every sweep, so the answer is usually known before a visitor asks
   * for anything.
   */
  async checkDirect(): Promise<boolean> {
    const started = Date.now();
    try {
      const response = await requestThrough(this.probeUrl, {
        entry: null,
        hop: null,
        timeoutMs: this.entryTimeoutMs,
        headers: { "User-Agent": USER_AGENT },
      });
      const ok = response.status >= 200 && response.status < 400;
      this.directState = {
        ok,
        lastError: ok ? null : `probe answered ${response.status}`,
        lastCheck: started,
        latencyMs: ok ? Date.now() - started : null,
      };
      return ok;
    } catch (error) {
      this.directState = {
        ok: false,
        lastError: (error instanceof Error ? error.message : "failed").slice(0, 200),
        lastCheck: started,
        latencyMs: null,
      };
      return false;
    }
  }

  /**
   * Should a request try going out with no proxy first?
   *
   * Only when that has actually been shown to work. `null` — not yet probed —
   * means no, because on the blocked machine an unproven "maybe" costs a full
   * timeout on every request until the sweep gets round to it.
   */
  get directWorks(): boolean {
    return this.directState.ok === true;
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

  /**
   * Claim the direct route out, if it works and is not already busy.
   *
   * Direct is one exit — this server's own IP — no matter how big the pool is,
   * and the forwarder reaches for it first whenever it works. Without a count,
   * every piece of a parallel route read took it at once and they all left from
   * the same address, which is the per-IP limit the whole split exists to get
   * under. The pieces that cannot have it go to a proxy, which is the point.
   *
   * Returns false when direct is unavailable or full. Always pair a true with
   * `releaseDirect()`.
   */
  takeDirect(): boolean {
    if (!this.directWorks) return false;
    if (this.directBusy >= DIRECT_CONCURRENCY) return false;
    this.directBusy += 1;
    return true;
  }

  releaseDirect(): void {
    this.directBusy = Math.max(0, this.directBusy - 1);
  }

  /**
   * How many DISTINCT ways out this server can supply at this moment.
   *
   * Working exits that are not resting, plus one for the direct route when
   * that works. This is what a caller must not ask for more of at once, and it
   * is reported to the client on every forwarded reply as `x-osm-exits` so the
   * route read can size its split to what actually exists.
   *
   * It exists because a fixed split met a pool that could not carry it. A real
   * box was running four working exits with nineteen resting after rate
   * limits, and a route read asking for four pieces at once left the last one
   * with nothing available at all — reported as "no route out worked", on a
   * server whose other three pieces had just come back fine.
   */
  capacity(): number {
    const now = Date.now();
    const free = this.states.filter(
      (state) => state.ok === true && !state.inFlight && state.restingUntil <= now,
    ).length;
    // Direct counts for the slots it has left, not for one and not for many:
    // it is a single IP that will carry a couple of requests at a time.
    const direct = this.directWorks ? Math.max(0, DIRECT_CONCURRENCY - this.directBusy) : 0;
    return free + direct;
  }

  /**
   * Wait a moment for a BUSY exit to come free. Never for a resting one.
   *
   * The distinction is the whole of it. A hop that is in flight will be back in
   * seconds and is worth waiting for — with a route read split into pieces,
   * every good exit being mid-request is an ordinary moment, not a failure. A
   * hop that is RESTING is one we have already decided not to use: waiting for
   * its cooldown to expire and then trying it inside the same request is
   * exactly the retry the cooldown exists to prevent, and it spends the whole
   * budget doing it. The first version of this did that, and turned two tests
   * into a thirty-second and a forty-five-second wait for a proxy already known
   * to be dead.
   *
   * So it returns at once when nothing is in flight: everything left is
   * resting, nothing will become available, and there is nothing to wait for.
   *
   * Polled rather than signalled: a waiter queue on every hop is a lot of
   * machinery to save a few hundred milliseconds on a path that is already
   * talking to a public proxy.
   */
  private async waitForExit(deadline: number): Promise<void> {
    const cap = Math.min(deadline, Date.now() + BUSY_WAIT_MS);
    while (Date.now() < cap) {
      const now = Date.now();
      if (this.states.some((state) => !state.inFlight && state.restingUntil <= now)) return;
      // Nothing is coming free. Everything left is resting out a cooldown.
      if (!this.states.some((state) => state.inFlight)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** One probe: the real chain, to a real upstream. */
  async probe(state: HopState, timeoutMs = this.probeTimeoutMs): Promise<void> {
    state.lastProbe = Date.now();
    try {
      const response = await requestThrough(this.probeUrl, {
        entry: this.entryFor(),
        hop: state.hop,
        timeoutMs,
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
  async sweep(concurrency = PROBE_CONCURRENCY): Promise<void> {
    if (this.sweeping) return;
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
    await Promise.all([this.checkEntry(), this.checkDirect()]);

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

    this.save();

    /*
     * Top up whenever this machine is short of working exits.
     *
     * It used to skip this entirely when `directWorks` — the reasoning being
     * that a server which can reach OpenStreetMap needs no proxy. That was
     * true while the proxies were only about REACHABILITY. They are now also
     * how a rate limit is got around, and a rate limit lands on precisely the
     * machine that can reach OpenStreetMap: its own IP is the one that has
     * used up its share. So both boxes keep a pool now.
     *
     * Still not more than once an hour — these lists refresh on the order of
     * hours, and probing hundreds of dead addresses is not free.
     */
    const working = this.states.filter((state) => state.ok === true).length;
    /*
     * Starving is not the same as thin, and it must not wait an hour.
     *
     * A long route split many ways wants dozens of exits at once. Below
     * `STARVING` the page is failing reads right now, and each round only
     * probes a bounded bite of what it downloads — so going back sooner really
     * does find addresses this box has not tried yet, rather than re-probing
     * the same corpses.
     */
    const wait = working < STARVING ? HUNGRY_SCRAPE_INTERVAL_MS : this.scrapeIntervalMs;
    if (working < this.minWorking && Date.now() - this.lastScrape > wait) {
      await this.refill();
    }
  }

  /**
   * Fetch one public list.
   *
   * Directly if this box can, and otherwise through an exit that already
   * works — the machine that needs more proxies is often the one that cannot
   * reach GitHub either, and the one proxy it has is the way to get the rest.
   */
  private async fetchList(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.probeTimeoutMs),
        headers: { "User-Agent": USER_AGENT },
      });
      if (response.ok) return await response.text();
    } catch {
      // Fall through and try a proxy.
    }

    const best = rank(this.states, Date.now()).find((state) => state.ok === true);
    if (!best) return null;
    try {
      const response = await requestThrough(url, {
        entry: this.entryFor(),
        hop: best.hop,
        timeoutMs: this.probeTimeoutMs,
        headers: { "User-Agent": USER_AGENT },
      });
      return response.status === 200 ? response.body.toString("utf8") : null;
    } catch {
      return null;
    }
  }

  /** Probe a batch, a few at a time, with the entry proxy left in peace. */
  private async probeBatch(batch: HopState[], concurrency: number, timeoutMs: number): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const state = batch[next++];
        if (!state) return;
        await this.probe(state, timeoutMs);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  }

  /**
   * Go and find more exits, and keep the ones that work.
   *
   * This is what `npm run proxies -- --scrape --save` does, run by the server
   * itself, because the two machines need different answers and neither of
   * them should need somebody to SSH in and re-run a script when its proxies
   * die. Only the ones that answered are kept: a list of thousands costs a
   * timeout apiece on every boot to rediscover that they are dead.
   */
  async refill(concurrency = SCRAPE_CONCURRENCY): Promise<number> {
    if (this.scraping) return 0;
    this.scraping = true;
    this.lastScrape = Date.now();
    this.lastScrapeAdded = 0;

    try {
      const texts: string[] = [];
      for (const url of sources()) {
        const text = await this.fetchList(url);
        if (text) texts.push(text);
      }
      if (texts.length === 0) {
        this.lastScrapeError = "no source could be reached";
        return 0;
      }

      const known = new Set(this.states.map((state) => state.hop.label));
      const fresh: HopState[] = [];
      for (const address of mergeProxyLists(texts)) {
        if (known.has(address)) continue;
        const hop = parseHop(address);
        if (!hop) continue;
        fresh.push({
          hop, ok: null, latencyMs: null, lastProbe: 0, lastError: null,
          failures: 0, restingUntil: 0, inFlight: false, successes: 0,
        });
        if (fresh.length >= this.scrapeMax) break;
      }
      if (fresh.length === 0) {
        this.lastScrapeError = "every address found was one already known";
        return 0;
      }

      await this.probeBatch(fresh, concurrency, this.scrapeProbeTimeoutMs);

      // Only the ones that answered. The rest are not worth the memory, let
      // alone the timeout each would cost on the next sweep.
      const kept = fresh.filter((state) => state.ok === true);
      this.states = [...this.states, ...kept].slice(0, this.maxStates);
      this.lastScrapeAdded = kept.length;
      this.lastScrapeError = kept.length > 0 ? null : `none of ${fresh.length} fresh addresses answered`;
      this.save();
      return kept.length;
    } catch (error) {
      this.lastScrapeError = (error instanceof Error ? error.message : "failed").slice(0, 200);
      return 0;
    } finally {
      this.scraping = false;
    }
  }

  /**
   * Write what works to this machine's own file, so a restart is not a cold
   * start. Never the committed seed — that one is shared by both servers.
   */
  save(): void {
    const working = rank(this.states, Date.now()).filter((state) => state.ok === true);
    if (working.length === 0) return;
    try {
      const file = this.stateFile;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const records = toRecords(
        working.map((state) => state.hop.label),
        new Map(working.map((state) => [state.hop.label, state.latencyMs ?? 0])),
      );
      fs.writeFileSync(file, `${JSON.stringify(records, null, 2)}\n`);
    } catch {
      // A read-only checkout still runs; it just starts cold each time.
    }
  }

  /**
   * Start the background sweeps. Safe to call repeatedly.
   *
   * It runs even with an empty list. It used to return early there, which made
   * "no proxies yet" a permanent condition on a fresh checkout: nothing swept,
   * so nothing scraped, so the list stayed empty. The first sweep on an empty
   * list does nothing but probe direct and then go looking, which is exactly
   * what that box needs.
   */
  start(): void {
    if (this.timer) return;
    void this.sweep();
    const interval = SWEEP_INTERVAL_MS;
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
  ): Promise<
    | { ok: true; value: T; via: string; attempts: number }
    | { ok: false; tried: string[]; reasons: string[]; limited: boolean }
  > {
    const tried: string[] = [];
    const reasons: string[] = [];
    /*
     * Did the upstream rate limit us, as opposed to nothing getting through?
     *
     * The caller turns this into what the person reading the map is told, and
     * the two are genuinely different situations: "we have asked
     * OpenStreetMap too much and it is holding us off" is temporary and their
     * doing nothing wrong, while "no route out worked" is this server being
     * broken. Reporting the first as the second sends whoever is debugging at
     * the proxy list when the proxy list is fine.
     */
    let limited = false;
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
      /*
       * A free exit if there is one, and a busy one only if there is not.
       *
       * Free first is what gives the parallel chunks of a route read an exit
       * each. The fallback matters on a machine that has found only two or
       * three working proxies: without it the later chunks would find every
       * good exit in flight, get nothing at all, and fail the read for want of
       * a proxy while three perfectly good ones were mid-request.
       */
      const pick = (includeInFlight: boolean): HopState | undefined =>
        rank(this.states, Date.now(), { includeInFlight }).find(
          (candidate) => !used.has(candidate.hop.label),
        );
      let state = pick(false) ?? pick(true);
      if (!state) {
        /*
         * Every exit is busy or resting. Wait for one, do not fail the read.
         *
         * This is the case that produced the reported error. With four working
         * exits and a route split into four pieces, the last piece regularly
         * found nothing available — `rank()` excludes both in-flight and
         * resting hops — and `rotate()` returned having tried NOTHING, which
         * the forwarder could only report as "no route out worked". The pool
         * was fine; it was momentarily full.
         *
         * Bounded by the same deadline as everything else, so a genuinely
         * empty pool still fails fast rather than hanging the page.
         */
        await this.waitForExit(deadline);
        state = pick(false) ?? pick(true);
        if (!state) {
          reasons.push("every exit was busy or resting for the whole budget");
          break;
        }
      }

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
        else if (outcome.fault === "limit") { this.limited(state, outcome.reason); limited = true; }
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

    return { ok: false, tried, reasons, limited };
  }

  /**
   * The one sentence worth reading, or null when nothing is obviously wrong.
   *
   * The status page used to answer with `working: 0` and eight identical
   * failures, and working out that they all named the same LAN address was
   * left to whoever was reading. This says it.
   */
  problem(): string | null {
    /*
     * A dead entry is worth saying even when everything else works.
     *
     * It is bypassed, so nothing is broken — but it costs a probe every sweep
     * and it sits in the status looking like the cause of whatever else is
     * wrong. A line left in `.env` for a machine that has gone away should be
     * reported until it is taken out.
     */
    if (this.entry && this.entryState.ok === false) {
      const stale =
        `OSM_PROXY_ENTRY is set to ${this.entry.label}, which this server cannot reach ` +
        `(${this.entryState.lastError ?? "no connection"}). It is being ignored. ` +
        `Remove the line from .env unless the exits really are reachable only through it.`;
      return this.directWorks ? stale : `${stale} Exits are being tried directly instead.`;
    }
    if (this.directWorks) return null;   // nothing to route around
    if (this.states.length === 0 && !this.entry) {
      return "No proxies are configured. This server is fetching OpenStreetMap directly.";
    }
    if (this.states.length > 0 && this.states.every((state) => state.ok === false)) {
      return (
        "This server cannot reach OpenStreetMap directly and every proxy in the list has " +
        "failed. Set OSM_PROXY_LIST to a proxy that works from here."
      );
    }
    return null;
  }

  summary(): {
    entry: string | null;
    entryOk: boolean | null;
    entryError: string | null;
    bypassingEntry: boolean;
    directOk: boolean | null;
    directError: string | null;
    scraping: boolean;
    lastScrape: number;
    lastScrapeAdded: number;
    lastScrapeError: string | null;
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
      // Whether a proxy is needed at all, which is the first thing to know.
      directOk: this.directState.ok,
      directError: this.directState.lastError,
      // Whether the server is finding its own proxies, and how that went.
      scraping: this.scraping,
      lastScrape: this.lastScrape,
      lastScrapeAdded: this.lastScrapeAdded,
      lastScrapeError: this.lastScrapeError,
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
