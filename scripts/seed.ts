/**
 * `npm run seed` — wipe the database and fill the crime layer with example data.
 *
 * This is what the reverse proxy's 💣 Reseed DB button runs. Every platform on
 * that box answers the same command, and the contract they all keep is written
 * down once, in the proxy's README under "The seed contract". Read that before
 * changing the flags here. The proxy merges `env/maddie.env` into the
 * environment first, so `MONGO_URI` arrives exactly as it does when the server
 * starts.
 *
 *   npm run seed              wipe the database, then write the example reports
 *   npm run seed -- --force   the button: wipe and rewrite, ignoring every
 *                             keep/skip flag and every SEED_* env var
 *   npm run seed -- --keep    keep every report a person typed; replace only
 *                             the example ones (what a bare seed used to do)
 *   npm run seed -- --no-demo wipe and write nothing.  `--clear` still works
 *   npm run seed -- --count=400 --days=90 --seed=7
 *
 * DESTRUCTIVE BY DEFAULT — and on this app "destructive" has a specific cost:
 * the reports collection holds things PEOPLE TYPED about being followed,
 * harassed or assaulted, and there is no other copy of them. A wipe here is not
 * a wipe of demo rows. `--keep` is the switch that spares them, and it is the
 * one to reach for on anything but a fresh box.
 *
 * WHAT IT WRITES IS MADE UP. Every point carries `source: "example"`, and the
 * app marks those differently everywhere they appear — see `src/lib/seed-data.ts`
 * for why that is not decoration. This exists so the filters and the map can be
 * demonstrated before the interviews are done, and it is meant to be cleared
 * when they are: one click in the panel, or `npm run seed -- --no-demo`.
 */

import { fromDoc, mongoUri, databaseName, db, reportsCollection, REPORTS, toDoc } from "../src/lib/db.ts";
import { resolveSeedFlags } from "../src/lib/seed-flags.ts";
import { buildSeedReports, DEFAULT_SEED_TOTAL } from "../src/lib/seed-data.ts";

const flags = resolveSeedFlags({ argv: process.argv.slice(2), env: process.env });

async function main(): Promise<number> {
  if (flags.error) {
    console.error(`seed: ${flags.error}`);
    return 2;
  }

  const uri = mongoUri();
  if (!uri) {
    // Not a failure. Without a database this deployment keeps reports in each
    // browser, and there is no shared collection for a seed to write to.
    console.log("MONGO_URI is not set, so there is no shared database to seed.");
    console.log("Reports are kept in each visitor's own browser on this deployment.");
    console.log("Set MONGO_URI=mongodb://127.0.0.1:27017/maddie in env/maddie.env and run this again.");
    return 0;
  }

  console.log(`database: ${databaseName(uri)}  (${uri.replace(/\/\/[^@]*@/, "//***@")})`);
  if (flags.force) {
    console.log("--force: wiping and rewriting everything; no keep/skip switch is read.");
  }

  // ── Preflight ─────────────────────────────────────────────────────────────
  // Build the reports BEFORE anything is deleted. The wipe below is the point
  // of no return, and a bad `--count` or a generator that throws after it would
  // leave an empty collection, no example data, and reports that people typed
  // gone with it. A seed that declines to run costs nothing.
  const reports = flags.demo
    ? buildSeedReports({
        total: flags.total ?? DEFAULT_SEED_TOTAL,
        seed: flags.randomSeed ?? 20260904,
        days: flags.days ?? 120,
      })
    : [];

  const collection = await reportsCollection();
  if (!collection) {
    console.error("Could not open the reports collection.");
    return 1;
  }

  const before = await collection.countDocuments({});
  const community = await collection.countDocuments({ source: "community" });

  // ── Wipe ──────────────────────────────────────────────────────────────────
  if (flags.keep) {
    const dropped = await collection.deleteMany({ source: "example" });
    console.log(`--keep: removed ${dropped.deletedCount} old example reports; kept ${community} entered by people.`);
  } else {
    // dropDatabase, not deleteMany: dropping also clears collection options and
    // the whole index catalogue, so nothing survives from a previous shape of
    // this app. The inventory is logged BEFORE it goes — if this ever runs
    // against the wrong database, that line is the only forensic trail.
    const database = await db();
    if (!database) {
      console.error("Could not open the database.");
      return 1;
    }
    const names = (await database.listCollections({}, { nameOnly: true }).toArray())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("system."));
    console.log(
      `wiping ${databaseName(uri)} — ${names.length} collection(s), ${before} reports, ` +
        `${community} of them entered by people.  [${names.join(" ") || "empty"}]`,
    );
    await database.dropDatabase();
  }

  // Rebuild the indexes the drop took with it. `reportsCollection()` owns them
  // — the unique `id`, the 2dsphere on `loc`, `source` and `atMs` — so asking
  // for the collection again is what puts them back.
  const rebuilt = await reportsCollection();
  if (!rebuilt) {
    console.error("Could not reopen the reports collection after the wipe.");
    return 1;
  }
  const indexes = await rebuilt.indexes();
  console.log(`indexes on ${REPORTS}: ${indexes.map((index) => index.name).join(", ")}`);

  if (reports.length === 0) {
    console.log(flags.demo ? "nothing to write." : "no example data written (--no-demo).");
    console.log(`reports now: ${await rebuilt.countDocuments({})}`);
    return 0;
  }

  // One ordered:false bulk write: a duplicate id from a re-run should not stop
  // the rest, and 180 individual round trips is 180 round trips.
  await rebuilt.bulkWrite(
    reports.map((report) => ({
      updateOne: { filter: { id: report.id }, update: { $set: toDoc(report) }, upsert: true },
    })),
    { ordered: false },
  );

  const after = await rebuilt.countDocuments({});
  const examples = await rebuilt.countDocuments({ source: "example" });
  const remaining = await rebuilt.countDocuments({ source: "community" });
  const sample = await rebuilt.findOne({ source: "example" });

  // The summary block. Every platform on this box ends its seed with one, in
  // plain text on stdout, because it is read by a person in the panel's log
  // tail seconds after they pressed a button. Maddie has no logins to print —
  // it has no accounts at all — so what goes here instead is what the map will
  // now show, and how much of it is invented.
  const line = "─".repeat(72);
  console.log("");
  console.log(line);
  console.log("  Maddie — SEED COMPLETE");
  console.log(line);
  console.log("");
  console.log(`  🗺  DATABASE            ${databaseName(uri)}`);
  console.log(`      reports             ${before} → ${after}`);
  console.log(`      example data        ${examples}   (wrote ${reports.length})`);
  console.log(`      entered by people   ${remaining}${flags.keep ? "  (kept)" : ""}`);
  if (sample) console.log(`      sample              ${JSON.stringify(fromDoc(sample))}`);
  console.log("");
  console.log("  ⚠  NONE OF THIS HAPPENED. It is generated data so the crime filter can");
  console.log("     be demonstrated before the interviews exist. The app draws every one");
  console.log("     of these as a hollow dashed marker, says EXAMPLE DATA in its popup,");
  console.log("     and shows a banner in the panel while any are loaded.");
  console.log("     Clear them from the panel, or with:  npm run seed -- --no-demo");
  console.log("");
  console.log(line);
  console.log("");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("seed failed:", error instanceof Error ? error.message : error);
    // A wrong or unreachable MONGO_URI is the usual cause, and the proxy shows
    // this line in the platform's log tail.
    console.error("Check MONGO_URI in env/maddie.env, and that mongod is running.");
    process.exit(1);
  });
