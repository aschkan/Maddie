/**
 * Process-wide concurrency gates and per-key cooldowns.
 *
 * Held on `globalThis` on purpose. Next loads modules in several graphs (the
 * server graph, the route graph, the edge graph, and again after a hot
 * reload); a gate kept in module scope is therefore several gates, and
 * "concurrency 1" against Overpass silently becomes concurrency 3 — which is
 * exactly what earns a 429.
 */

type Waiter = () => void;

class Gate {
  private active = 0;
  private queue: Waiter[] = [];
  private lastStart = 0;

  readonly maxConcurrent: number;
  readonly minIntervalMs: number;

  constructor(maxConcurrent: number, minIntervalMs: number) {
    this.maxConcurrent = maxConcurrent;
    this.minIntervalMs = minIntervalMs;
  }

  private async pace(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const earliest = this.lastStart + this.minIntervalMs;
    if (earliest > now) await new Promise((resolve) => setTimeout(resolve, earliest - now));
    this.lastStart = Date.now();
  }

  /** Runs `task` with a slot held. The slot is released even if `task` throws. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      await this.pace();
      return await task();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get inFlight(): number {
    return this.active;
  }
}

export type { Gate };

interface GateKey {
  maxConcurrent: number;
  minIntervalMs: number;
}

const GATES = "__maddie_gates__";
const COOLDOWNS = "__maddie_cooldowns__";

type GlobalBag = typeof globalThis & {
  [GATES]?: Map<string, Gate>;
  [COOLDOWNS]?: Map<string, number>;
};

function gates(): Map<string, Gate> {
  const bag = globalThis as GlobalBag;
  if (!bag[GATES]) bag[GATES] = new Map<string, Gate>();
  return bag[GATES];
}

/**
 * One gate per name, created on first use. The settings of the first caller
 * win: a gate that changed shape mid-flight would let queued work through.
 */
export function gate(name: string, options: GateKey): Gate {
  const existing = gates().get(name);
  if (existing) return existing;
  const created = new Gate(Math.max(1, options.maxConcurrent), Math.max(0, options.minIntervalMs));
  gates().set(name, created);
  return created;
}

function cooldowns(): Map<string, number> {
  const bag = globalThis as GlobalBag;
  if (!bag[COOLDOWNS]) bag[COOLDOWNS] = new Map<string, number>();
  return bag[COOLDOWNS];
}

/** Milliseconds still to wait before `key` may be used again; 0 when free. */
export function cooldownRemaining(key: string, now = Date.now()): number {
  const until = cooldowns().get(key);
  if (until === undefined) return 0;
  if (until <= now) {
    cooldowns().delete(key);
    return 0;
  }
  return until - now;
}

/** Rests `key` for at least `ms`. Never shortens an existing, longer rest. */
export function rest(key: string, ms: number, now = Date.now()): void {
  if (ms <= 0) return;
  const until = now + ms;
  const existing = cooldowns().get(key) ?? 0;
  cooldowns().set(key, Math.max(existing, until));
}

export function clearCooldowns(): void {
  cooldowns().clear();
}

/**
 * How long an upstream should be rested, by the kind of failure.
 *
 * A timeout rests longest: discovering a hung mirror costs the full timeout,
 * and with queries serialised everything behind it waited that long too.
 * A rate limit and a timeout are different failures — collapsing them leaves
 * a hung mirror in rotation forever, because it never returns a status at all.
 */
export function cooldownFor(kind: "rate-limit" | "server-error" | "timeout", retryAfterMs = 0): number {
  switch (kind) {
    case "rate-limit":
      return Math.max(120_000, retryAfterMs);
    case "server-error":
      return 30_000;
    case "timeout":
      return 180_000;
  }
}

/** `Retry-After` is either seconds or an HTTP date. Returns milliseconds. */
export function parseRetryAfter(header: string | null, now = Date.now()): number {
  if (!header) return 0;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, at - now);
}
