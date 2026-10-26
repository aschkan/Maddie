/**
 * `npm run seed` — rebuild the database from the REAL data it holds.
 *
 * This is what the platform proxy's 💣 Reseed DB button runs (`npm run seed --
 * --force`, with this app's `.env` merged in). The contract all platforms keep
 * is in the proxy's README, "The seed contract": preflight → drop → indexes →
 * data → print the logins. Read that before changing the order here.
 *
 * THERE IS NO INVENTED DATA ANY MORE. The seed used to write 180 example
 * reports and 24 synthetic interviews; both generators are deleted. What a
 * reseed now does is put back the study's real material, cleanly:
 *
 *   * the Pointer "Onveilige plekken" survey (~18k places, `source: "pointer"`),
 *   * places the team added in /admin (`admin`) and community reports
 *     (`community`),
 *   * the interview transcripts (`fieldwork`),
 *   * the provenance rows (`datasets`).
 *
 * Where does a reseed get them from, if it drops the database? FROM THE
 * DATABASE, read in preflight — and written to a backup file on disk before
 * anything is dropped:
 *
 *   1. Preflight: read every collection into memory. Anything marked
 *      `source: "example"` (an older version's demo rows) is discarded here.
 *      Every report and interview goes through the app's own parser, so a row
 *      in an older shape is migrated, never half-copied.
 *   2. Write `.data/seed-backup/<timestamp>.json` — the WHOLE snapshot. If the
 *      process dies between the drop and the restore, that file is the data,
 *      and the next seed restores from it (step 1 falls back to the newest
 *      backup when the database is empty). The last five are kept.
 *   3. `dropDatabase()` — the contract's wipe: indexes, collection options and
 *      any stray collection from an earlier shape of the app go with it.
 *   4. Recreate the collections with their indexes (unique `id`, the 2dsphere
 *      on `loc` — a 2dsphere that quietly did not come back is a geo query
 *      that returns nothing on a map that looks fine).
 *   5. Restore, in batches of 500 with a pause between (one big insert floods
 *      the replica set's tunnel and the primary steps down mid-write).
 *   6. Print what is there and the /admin login, in plain text.
 *
 * So the button keeps its meaning — press once, get a clean platform you can
 * log into and click around — without destroying the only copy of real
 * research data. The first load of the data is an IMPORT, not a seed:
 * `scripts/import-pointer.ts` and `scripts/import-interviews.ts`, or the
 * import in /admin.
 *
 *   npm run seed               the same as --force
 *   npm run seed -- --force    what the button runs
 *   npm run seed -- --dry-run  preflight and backup only; drop nothing
 *
 * No `MONGO_URI` is not a failure: this app then keeps community reports in
 * each browser and has nothing shared to seed. It says so and exits 0.
 * There is no Redis here and there will not be one.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ADMIN_USER, adminPassword } from "../src/lib/auth.ts";
import {
  databaseName, datasetsCollection, db, fromInterviewDoc, interviewsCollection, mongoUri,
  reportsCollection, toDoc, toInterviewDoc, type DatasetDoc, type InterviewDoc, type ReportDoc,
} from "../src/lib/db.ts";
import { insertBatched } from "../src/lib/importer.ts";
import { parseInterviews, type Interview } from "../src/lib/interviews.ts";
import { parseReport, type Report } from "../src/lib/reports.ts";

const BACKUP_DIR = join(process.cwd(), ".data", "seed-backup");
const KEEP_BACKUPS = 5;

interface Snapshot {
  takenAt: string;
  reports: Report[];
  interviews: Interview[];
  datasets: DatasetDoc[];
}

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has("--dry-run");

function stripReport(doc: ReportDoc & { _id?: unknown }): unknown {
  const { _id, atMs, loc, ...rest } = doc;
  void _id; void atMs; void loc;
  return rest;
}

function latestBackup(): Snapshot | null {
  try {
    // Newest first; a backup is only ever written with data in it.
    for (const file of readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json")).sort().reverse()) {
      const raw = JSON.parse(readFileSync(join(BACKUP_DIR, file), "utf8")) as Partial<Snapshot>;
      const snapshot: Snapshot = {
        takenAt: String(raw.takenAt ?? ""),
        reports: (raw.reports ?? []).map(parseReport).filter((r): r is Report => r !== null),
        interviews: parseInterviews(raw.interviews ?? []),
        datasets: Array.isArray(raw.datasets) ? raw.datasets : [],
      };
      if (snapshot.reports.length + snapshot.interviews.length > 0) {
        console.log(`The database is empty — restoring from the newest backup, ${file}.`);
        return snapshot;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function writeBackup(snapshot: Snapshot): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `${snapshot.takenAt.replace(/[:.]/g, "-")}.json`;
  writeFileSync(join(BACKUP_DIR, name), JSON.stringify(snapshot));
  const files = readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json")).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP_BACKUPS))) rmSync(join(BACKUP_DIR, old));
  return join(BACKUP_DIR, name);
}

function count<T>(items: readonly T[], key: (item: T) => string): string {
  const tally = new Map<string, number>();
  for (const item of items) tally.set(key(item), (tally.get(key(item)) ?? 0) + 1);
  return [...tally].map(([k, n]) => `${n} ${k}`).join(", ") || "none";
}

async function main(): Promise<number> {
  const uri = mongoUri();
  if (!uri) {
    console.log("MONGO_URI is not set, so there is no shared database to seed.");
    console.log("Community reports are kept in each visitor's own browser on this deployment.");
    return 0;
  }
  console.log(`database: ${databaseName(uri)}  (${uri.replace(/\/\/[^@]*@/, "//***@")})`);

  // ── 1. Preflight: read everything real ─────────────────────────────────────
  const reportsIn = await reportsCollection();
  const interviewsIn = await interviewsCollection();
  const datasetsIn = await datasetsCollection();
  if (!reportsIn || !interviewsIn || !datasetsIn) {
    console.error("Could not open the collections.");
    return 1;
  }
  const rawReports = await reportsIn.find({}).toArray();
  const rawInterviews = await interviewsIn.find({}).toArray();
  let snapshot: Snapshot = {
    takenAt: new Date().toISOString(),
    reports: rawReports.map((doc) => parseReport(stripReport(doc))).filter((r): r is Report => r !== null),
    interviews: parseInterviews(rawInterviews.map((doc) => fromInterviewDoc(doc as InterviewDoc))),
    datasets: (await datasetsIn.find({}, { projection: { _id: 0 } }).toArray()) as DatasetDoc[],
  };
  const droppedExamples =
    rawReports.filter((d) => (d as { source?: string }).source === "example").length +
    rawInterviews.filter((d) => (d as { source?: string }).source === "example").length;
  if (droppedExamples > 0) {
    console.log(`Discarding ${droppedExamples} example/synthetic record(s) left by an older version — there is no demo data any more.`);
  }

  if (snapshot.reports.length === 0 && snapshot.interviews.length === 0) {
    const backup = latestBackup();
    if (backup) snapshot = { ...backup, takenAt: snapshot.takenAt };
  }
  if (snapshot.reports.length === 0 && snapshot.interviews.length === 0) {
    console.log("");
    console.log("The database holds no data yet and there is no backup to restore from.");
    console.log("Load the real data first — this seed invents nothing:");
    console.log("  node scripts/import-pointer.ts <Pointer export .csv>");
    console.log("  node scripts/import-interviews.ts <folder with the transcript .json files>");
    console.log("or sign in at /admin and use Import.");
  }

  // ── 2. Backup, before anything is dropped ─────────────────────────────────
  // Never an EMPTY backup: it would rotate a good one out of the five kept.
  const empty = snapshot.reports.length + snapshot.interviews.length === 0;
  const backupPath = empty ? "(nothing to back up)" : writeBackup(snapshot);
  console.log(`backup: ${backupPath}`);
  console.log(`  reports:    ${snapshot.reports.length} (${count(snapshot.reports, (r) => r.source)})`);
  console.log(`  interviews: ${snapshot.interviews.length}`);
  if (dryRun) {
    console.log("--dry-run: nothing dropped.");
    return 0;
  }

  // ── 3. Drop ───────────────────────────────────────────────────────────────
  const database = await db();
  if (!database) {
    console.error("Could not open the database.");
    return 1;
  }
  const names = (await database.listCollections({}, { nameOnly: true }).toArray())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("system."));
  console.log(`dropping ${databaseName(uri)}: ${names.join(", ") || "(empty)"}`);
  await database.dropDatabase();

  // ── 4. Indexes (asking for the collection creates them) ───────────────────
  const reports = await reportsCollection();
  const interviews = await interviewsCollection();
  const datasets = await datasetsCollection();
  if (!reports || !interviews || !datasets) {
    console.error(`Could not recreate the collections. The data is safe in ${backupPath} — run the seed again.`);
    return 1;
  }

  // ── 5. Restore ────────────────────────────────────────────────────────────
  const wroteReports = await insertBatched<ReportDoc>(reports, snapshot.reports.map(toDoc));
  const wroteInterviews = await insertBatched<InterviewDoc>(interviews, snapshot.interviews.map(toInterviewDoc));
  if (snapshot.datasets.length > 0) await insertBatched<DatasetDoc>(datasets, snapshot.datasets);

  // ── 6. What is there now, and how to get in ───────────────────────────────
  console.log("");
  console.log("════════════════════════════════════════════════════════════");
  console.log(" Maddie — database rebuilt from real data (nothing invented)");
  console.log("════════════════════════════════════════════════════════════");
  console.log(` reports:    ${wroteReports}  (${count(snapshot.reports, (r) => r.source)})`);
  console.log(` interviews: ${wroteInterviews}  (${snapshot.interviews.map((i) => i.code).join(", ") || "none"})`);
  for (const set of snapshot.datasets) {
    console.log(` dataset:    ${set.name} — ${set.rows} rows${set.exportedAt ? `, export of ${set.exportedAt}` : ""}`);
    console.log(`             credit: ${set.credit}`);
  }
  console.log("");
  console.log(" Admin (add places, import a new Pointer export, add interviews):");
  console.log("   https://maddie.arsaces.ir/admin");
  const password = adminPassword();
  if (password) {
    console.log(`   user:     ${ADMIN_USER}`);
    console.log(`   password: ${password}`);
  } else {
    console.log("   NOT CONFIGURED — ADMIN_PASSWORD / SESSION_SECRET are not in .env.");
    console.log("   Press 🔑 Fix secrets on the platform card, restart Maddie, and reseed to see the login here.");
  }
  console.log("════════════════════════════════════════════════════════════");
  return wroteReports === snapshot.reports.length && wroteInterviews === snapshot.interviews.length ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    console.error(`Nothing is lost if a backup line was printed above: the next seed restores from it.`);
    process.exit(1);
  });
