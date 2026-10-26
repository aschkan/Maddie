/**
 * Writing a dataset into MongoDB — shared by `scripts/import-pointer.ts`, the
 * seed's restore, and the admin panel's import. SERVER ONLY.
 *
 * In BATCHES, with a pause between them. One `insertMany` of 18k documents
 * floods the replica set's tunnel; heartbeats time out, the primary steps
 * down, and the write fails with "not primary" half-way through — measured on
 * this cluster, not imagined. 500 at a time with a breath between is slower
 * and nothing else notices.
 */

import type { AnyBulkWriteOperation, Collection } from "mongodb";

import { toDoc, type DatasetDoc, type ReportDoc } from "./db.ts";
import { POINTER_CREDIT } from "./pointer.ts";
import type { Report } from "./reports.ts";

export const BATCH = 500;
const PAUSE_MS = 150;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upsert by `id`. A re-import of the same export changes nothing; a newer
 * export updates the rows it still has and adds the new ones. Rows that are
 * no longer in the export are LEFT ALONE — absence from one file is not a
 * deletion (Pointer removes rows after moderation, and the team decides).
 */
export async function upsertReports(
  collection: Collection<ReportDoc>,
  reports: readonly Report[],
  onBatch?: (done: number, total: number) => void,
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < reports.length; i += BATCH) {
    const ops: AnyBulkWriteOperation<ReportDoc>[] = reports.slice(i, i + BATCH).map((report) => ({
      replaceOne: { filter: { id: report.id }, replacement: toDoc(report), upsert: true },
    }));
    const result = await collection.bulkWrite(ops, { ordered: false });
    inserted += result.upsertedCount;
    updated += result.modifiedCount;
    onBatch?.(Math.min(i + BATCH, reports.length), reports.length);
    if (i + BATCH < reports.length) await sleep(PAUSE_MS);
  }
  return { inserted, updated };
}

/** Write (or refresh) the Pointer provenance row the boards print. */
export async function recordPointerDataset(
  reports: Collection<ReportDoc>,
  datasets: Collection<DatasetDoc>,
  meta: { version?: string; exportedAt?: string },
): Promise<void> {
  await datasets.updateOne(
    { id: "pointer" },
    {
      $set: {
        id: "pointer",
        name: "Pointer — Onveilige plekken",
        credit: POINTER_CREDIT,
        rows: await reports.countDocuments({ source: "pointer" }),
        importedAt: new Date().toISOString(),
        ...(meta.version ? { version: meta.version } : {}),
        ...(meta.exportedAt ? { exportedAt: meta.exportedAt } : {}),
      },
    },
    { upsert: true },
  );
}

/** Insert raw documents in batches — the seed's restore. */
export async function insertBatched<T extends object>(collection: Collection<T>, docs: readonly T[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH) as unknown as Parameters<Collection<T>["insertMany"]>[0];
    const result = await collection.insertMany(batch, { ordered: false });
    written += result.insertedCount;
    if (i + BATCH < docs.length) await sleep(PAUSE_MS);
  }
  return written;
}
