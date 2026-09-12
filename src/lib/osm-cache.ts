/**
 * What the forwarder already fetched. SERVER ONLY.
 *
 * The rate limit is the reason this exists, and spreading requests over more
 * exit IPs is the wrong lever to reach for first: it takes more from a donated
 * service rather than asking for less. Most of what this app asks for twice is
 * identical both times — the same tile while panning back and forth, the same
 * Overpass query for the visible map after a pan that returned to where it
 * started, the same address typed again. Answering those from memory removes
 * the request rather than relocating it.
 *
 * Bounded two ways, because an unbounded cache on a long-lived server is a
 * memory leak with a nice name: every entry expires, and the whole thing has a
 * byte ceiling with least-recently-used eviction.
 */

import crypto from "node:crypto";

export interface Cached {
  status: number;
  contentType: string | null;
  body: Buffer;
  /** When it was stored, in epoch ms. */
  at: number;
}

/** One cache key per distinct request. The body matters: Overpass POSTs. */
export function cacheKey(service: string, method: string, path: string, search: string, body?: Buffer): string {
  const hash = crypto.createHash("sha256");
  hash.update(service).update("\0").update(method).update("\0");
  hash.update(path).update("\0").update(search);
  if (body && body.length > 0) hash.update("\0").update(body);
  return hash.digest("hex");
}

export class ResponseCache {
  /** Insertion order is the LRU order; a read re-inserts. */
  private entries: Map<string, Cached>;
  private bytes: number;
  maxBytes: number;
  hits: number;
  misses: number;

  constructor(maxBytes: number) {
    this.entries = new Map();
    this.bytes = 0;
    this.maxBytes = Math.max(0, maxBytes);
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number { return this.entries.size; }
  get storedBytes(): number { return this.bytes; }

  /**
   * A stored reply, if there is a fresh one.
   *
   * `ttlMs` is passed in per lookup rather than stored per entry, so changing
   * a service's freshness does not require the cache to be cleared — and a
   * zero TTL is simply never a hit.
   */
  get(key: string, ttlMs: number, now = Date.now()): Cached | null {
    const found = this.entries.get(key);
    if (!found) { this.misses++; return null; }

    if (ttlMs <= 0 || now - found.at >= ttlMs) {
      this.entries.delete(key);
      this.bytes -= found.body.length;
      this.misses++;
      return null;
    }

    // Re-insert, so the most recently used entry is last and eviction takes
    // from the other end.
    this.entries.delete(key);
    this.entries.set(key, found);
    this.hits++;
    return found;
  }

  /**
   * Store a reply, evicting the least recently used until it fits.
   *
   * Only successes: a 429 is exactly the answer that must not be remembered,
   * and a 500 cached for ten minutes turns a blip into an outage.
   */
  set(key: string, value: Cached): void {
    if (value.status !== 200) return;
    if (this.maxBytes === 0 || value.body.length > this.maxBytes) return;

    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.bytes -= existing.body.length;
    }

    this.entries.set(key, value);
    this.bytes += value.body.length;

    for (const [oldest] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      const dropped = this.entries.get(oldest);
      if (!dropped) break;
      this.entries.delete(oldest);
      this.bytes -= dropped.body.length;
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  stats(): { entries: number; bytes: number; maxBytes: number; hits: number; misses: number } {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/*
 * One cache for the process, on `globalThis`.
 *
 * Next's dev server re-evaluates modules on every edit, and a fresh cache per
 * edit is a cache that never hits — the same reason `db.ts` pins its client.
 */
const globalCache = globalThis as unknown as { __maddieOsmCache?: ResponseCache };

export function osmCache(): ResponseCache {
  if (!globalCache.__maddieOsmCache) {
    globalCache.__maddieOsmCache = new ResponseCache(
      envNumber("OSM_CACHE_MAX_BYTES", 64 * 1024 * 1024),
    );
  }
  return globalCache.__maddieOsmCache;
}
