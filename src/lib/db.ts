/**
 * MongoDB, when there is one.
 *
 * SERVER ONLY. Nothing here may be imported from a component that runs in the
 * browser — the connection string is a credential.
 *
 * `MONGO_URI` is optional, and that is load-bearing rather than lax. This app
 * draws a map, plans routes and reads OpenStreetMap without any database at
 * all; only the crime layer needs somewhere to put things. With no URI the
 * reports stay in the browser that entered them, the API says so, and the page
 * says so on the screen. A missing database must never turn into an empty map
 * that looks like a quiet neighbourhood.
 *
 * The client is cached on `globalThis` because Next's dev server re-evaluates
 * modules on every edit, and a fresh `MongoClient` per edit opens a fresh pool
 * — a few dozen saves in and mongod is refusing connections.
 */

import { MongoClient, type Collection, type Db } from "mongodb";

import type { Report } from "./reports.ts";

/** The report as it is stored. `id` is ours; `_id` is Mongo's. */
export interface ReportDoc extends Report {
  /** Epoch ms of `at`, so the index can sort and range without parsing. */
  atMs: number;
  /** GeoJSON, for the 2dsphere index: [lng, lat] — longitude FIRST. */
  loc: { type: "Point"; coordinates: [number, number] };
}

export const REPORTS = "reports";

/**
 * The database name.
 *
 * Taken from the URI's path when it has one (`.../maddie`), which is how the
 * other platforms on this box are configured, and `maddie` otherwise. Never
 * `test`, which is what the driver picks when a URI carries no path — a silent
 * write to the wrong database that looks exactly like a working one.
 */
export function databaseName(uri: string): string {
  try {
    const path = new URL(uri.replace(/^mongodb\+srv:/, "mongodb:")).pathname.replace(/^\//, "");
    return path.length > 0 ? decodeURIComponent(path) : "maddie";
  } catch {
    return "maddie";
  }
}

export function mongoUri(): string | null {
  const uri = process.env.MONGO_URI?.trim();
  return uri ? uri : null;
}

interface Cache {
  client: MongoClient | null;
  promise: Promise<MongoClient> | null;
}

const globalCache = globalThis as unknown as { __maddieMongo?: Cache };
const cache: Cache = globalCache.__maddieMongo ?? { client: null, promise: null };
globalCache.__maddieMongo = cache;

/**
 * Connect, or say there is nowhere to connect to.
 *
 * Never throws for "no database configured" — that is a deployment choice, not
 * a fault. It does throw when a URI is set and unreachable, because that IS a
 * fault and silently degrading to browser storage would hide it.
 */
export async function db(): Promise<Db | null> {
  const uri = mongoUri();
  if (!uri) return null;

  if (!cache.client) {
    if (!cache.promise) {
      cache.promise = new MongoClient(uri, {
        // Fail fast. A page waiting thirty seconds on a dead mongod looks like
        // a broken app; five seconds looks like an error, which it is.
        serverSelectionTimeoutMS: 5_000,
        connectTimeoutMS: 5_000,
      }).connect();
    }
    cache.client = await cache.promise;
  }
  return cache.client.db(databaseName(uri));
}

/**
 * The reports collection, with its indexes.
 *
 * `createIndex` is idempotent, so this is safe to call per request; the driver
 * caches after the first.
 */
export async function reportsCollection(): Promise<Collection<ReportDoc> | null> {
  const database = await db();
  if (!database) return null;
  const collection = database.collection<ReportDoc>(REPORTS);
  await Promise.all([
    collection.createIndex({ id: 1 }, { unique: true }),
    collection.createIndex({ loc: "2dsphere" }),
    collection.createIndex({ source: 1 }),
    collection.createIndex({ atMs: -1 }),
  ]);
  return collection;
}

/** A report → the document that stores it. */
export function toDoc(report: Report): ReportDoc {
  return {
    ...report,
    atMs: Date.parse(report.at),
    // ⚠ GeoJSON is [longitude, latitude]. The same trap as OSRM: the wrong way
    // round still indexes and still returns results, just for somewhere else.
    loc: { type: "Point", coordinates: [report.point.lng, report.point.lat] },
  };
}

/** A stored document → the report, with the storage-only fields dropped. */
export function fromDoc(doc: ReportDoc): Report {
  return {
    id: doc.id,
    category: doc.category,
    point: doc.point,
    at: doc.at,
    source: doc.source,
    ...(doc.note ? { note: doc.note } : {}),
    ...(doc.area ? { area: doc.area } : {}),
  };
}
