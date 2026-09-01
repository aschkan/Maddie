/**
 * Storage. Upstash Redis over REST when it is configured, otherwise a JSON
 * file under MADDIE_DATA_DIR.
 *
 * No ORM and no database server on purpose: the app is a long-lived pm2
 * process behind a reverse proxy, not a serverless function, so a file is
 * genuinely fine — and one fewer thing that has to be running for a woman to
 * be able to read a safety score.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getConfig } from "../config.ts";
import { upstreamFetch } from "../http/fetch.ts";
import { logger } from "../log.ts";

const log = logger("store");

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Appends to a capped list, newest last. */
  append<T>(key: string, value: T, cap?: number): Promise<void>;
  list<T>(key: string): Promise<T[]>;
  /** Increments a counter that expires; used for rate limits. */
  increment(key: string, ttlSeconds: number): Promise<number>;
  readonly backend: "redis" | "file";
}

// ── Upstash over REST ───────────────────────────────────────────────────────

interface UpstashResult {
  result?: unknown;
  error?: string;
}

class RedisStore implements Store {
  readonly backend = "redis" as const;
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  private async command(parts: (string | number)[]): Promise<unknown> {
    const response = await upstreamFetch(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(parts.map(String)),
    });
    if (!response.ok) throw new Error(`Upstash answered ${response.status}`);
    const parsed = JSON.parse(response.text) as UpstashResult;
    if (typeof parsed.error === "string") throw new Error(parsed.error);
    return parsed.result ?? null;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.command(["GET", key]);
    if (typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const parts: (string | number)[] = ["SET", key, JSON.stringify(value)];
    if (ttlSeconds !== undefined && ttlSeconds > 0) parts.push("EX", Math.round(ttlSeconds));
    await this.command(parts);
  }

  async delete(key: string): Promise<void> {
    await this.command(["DEL", key]);
  }

  async append<T>(key: string, value: T, cap = 5_000): Promise<void> {
    await this.command(["RPUSH", key, JSON.stringify(value)]);
    await this.command(["LTRIM", key, -cap, -1]);
  }

  async list<T>(key: string): Promise<T[]> {
    const raw = await this.command(["LRANGE", key, 0, -1]);
    if (!Array.isArray(raw)) return [];
    const out: T[] = [];
    for (const item of raw) {
      if (typeof item !== "string") continue;
      try {
        out.push(JSON.parse(item) as T);
      } catch {
        /* a single unreadable row must not take the list down */
      }
    }
    return out;
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const raw = await this.command(["INCR", key]);
    const count = typeof raw === "number" ? raw : Number(raw ?? 0);
    if (count === 1) await this.command(["EXPIRE", key, Math.round(ttlSeconds)]);
    return count;
  }
}

// ── A JSON file ─────────────────────────────────────────────────────────────

interface FileShape {
  values: Record<string, { value: unknown; expiresAt: number | null }>;
  lists: Record<string, unknown[]>;
}

const EMPTY: FileShape = { values: {}, lists: {} };

class FileStore implements Store {
  readonly backend = "file" as const;
  private readonly path: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    // MADDIE_DATA_DIR is operator-configurable on purpose, so this path is
    // genuinely dynamic; the bundler is told not to trace it.
    this.path = join(resolve(/* turbopackIgnore: true */ process.cwd(), dataDir), "maddie.json");
  }

  /** Serialised: two concurrent reports must not overwrite each other. */
  private lock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<FileShape> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<FileShape>;
      return { values: parsed.values ?? {}, lists: parsed.lists ?? {} };
    } catch {
      return { values: { ...EMPTY.values }, lists: { ...EMPTY.lists } };
    }
  }

  private async write(shape: FileShape): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(shape), "utf8");
    // Rename is atomic on the same filesystem: a crash mid-write leaves the
    // previous file intact rather than a truncated one.
    await rename(temporary, this.path);
  }

  async get<T>(key: string): Promise<T | null> {
    return this.lock(async () => {
      const shape = await this.read();
      const entry = shape.values[key];
      if (entry === undefined) return null;
      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) return null;
      return entry.value as T;
    });
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.lock(async () => {
      const shape = await this.read();
      shape.values[key] = {
        value,
        expiresAt: ttlSeconds !== undefined && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
      };
      await this.write(shape);
    });
  }

  async delete(key: string): Promise<void> {
    await this.lock(async () => {
      const shape = await this.read();
      delete shape.values[key];
      delete shape.lists[key];
      await this.write(shape);
    });
  }

  async append<T>(key: string, value: T, cap = 5_000): Promise<void> {
    await this.lock(async () => {
      const shape = await this.read();
      const existing = shape.lists[key] ?? [];
      existing.push(value);
      shape.lists[key] = existing.slice(-cap);
      await this.write(shape);
    });
  }

  async list<T>(key: string): Promise<T[]> {
    return this.lock(async () => {
      const shape = await this.read();
      return (shape.lists[key] ?? []) as T[];
    });
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    return this.lock(async () => {
      const shape = await this.read();
      const entry = shape.values[key];
      const live = entry !== undefined && (entry.expiresAt === null || entry.expiresAt > Date.now());
      const count = live ? Number(entry.value ?? 0) + 1 : 1;
      shape.values[key] = {
        value: count,
        expiresAt: live ? (entry?.expiresAt ?? null) : Date.now() + ttlSeconds * 1000,
      };
      await this.write(shape);
      return count;
    });
  }
}

const BAG = "__maddie_store__";
type GlobalBag = typeof globalThis & { [BAG]?: Store };

export function getStore(): Store {
  const bag = globalThis as GlobalBag;
  if (bag[BAG]) return bag[BAG];
  const config = getConfig();
  const store =
    config.upstashUrl !== "" && config.upstashToken !== ""
      ? new RedisStore(config.upstashUrl, config.upstashToken)
      : new FileStore(config.dataDir);
  log.info(`storage backend: ${store.backend}`);
  bag[BAG] = store;
  return store;
}
