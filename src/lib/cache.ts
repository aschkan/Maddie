/**
 * A small in-process TTL cache with in-flight de-duplication.
 *
 * Two rules, both learned the hard way:
 *  - a rejected promise is NEVER stored. Caching a transient failure turns a
 *    ten-second outage into a day of "we could not look";
 *  - the in-flight entry is removed when the chain fails, so the next caller
 *    genuinely retries rather than awaiting the same dead promise.
 */
const BAG = "__maddie_cache__";

interface Entry<T> {
  value: T;
  expiresAt: number;
}

type Store = {
  values: Map<string, Entry<unknown>>;
  inflight: Map<string, Promise<unknown>>;
};

type GlobalBag = typeof globalThis & { [BAG]?: Store };

function store(): Store {
  const bag = globalThis as GlobalBag;
  if (!bag[BAG]) bag[BAG] = { values: new Map(), inflight: new Map() };
  return bag[BAG];
}

export function cacheGet<T>(key: string, now = Date.now()): T | undefined {
  const entry = store().values.get(key);
  if (entry === undefined) return undefined;
  if (entry.expiresAt <= now) {
    store().values.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number, now = Date.now()): void {
  if (ttlMs <= 0) return;
  store().values.set(key, { value, expiresAt: now + ttlMs });
}

export function cacheDelete(key: string): void {
  store().values.delete(key);
  store().inflight.delete(key);
}

export function cacheClear(): void {
  store().values.clear();
  store().inflight.clear();
}

export async function cached<T>(key: string, ttlMs: number, produce: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;

  const pending = store().inflight.get(key) as Promise<T> | undefined;
  if (pending !== undefined) return pending;

  const run = (async (): Promise<T> => {
    try {
      const value = await produce();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      // Whether it resolved or threw. A failed lap is never what gets stored.
      store().inflight.delete(key);
    }
  })();

  store().inflight.set(key, run);
  return run;
}
