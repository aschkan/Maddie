/**
 * `npm run seed` — fill the crime layer with example data.
 *
 * This is what the reverse proxy's per-platform seed button runs. The proxy
 * merges `env/maddie.env` into the environment first, so `MONGO_URI` arrives
 * here exactly as it does when the server starts.
 *
 * WHAT IT WRITES IS MADE UP. Every point carries `source: "example"`, and the
 * app marks those differently everywhere they appear — see `src/lib/seed-data.ts`
 * for why that is not decoration. This exists so the filters and the map can be
 * demonstrated before the interviews are done, and it is meant to be cleared
 * when they are: one click in the panel, or `npm run seed -- --clear`.
 *
 *   npm run seed              replace the example reports; keep every community one
 *   npm run seed -- --force   drop the whole collection first, community reports too
 *   npm run seed -- --clear   remove the example reports and write nothing
 *   npm run seed -- --count=400 --seed=7
 *
 * `--force` is the proxy's "💣 Reseed DB" button. It is destructive on purpose,
 * and it is the only path here that touches a report a person typed.
 */

import { fromDoc, mongoUri, databaseName, reportsCollection, toDoc } from "../src/lib/db.ts";
import { buildSeedReports, DEFAULT_SEED_TOTAL } from "../src/lib/seed-data.ts";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function value(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function number(name: string, fallback: number): number {
  const raw = value(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(): Promise<number> {
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

  const collection = await reportsCollection();
  if (!collection) {
    console.error("Could not open the reports collection.");
    return 1;
  }

  const before = await collection.countDocuments({});
  const community = await collection.countDocuments({ source: "community" });

  if (flag("force")) {
    // The one path that deletes something a person wrote. The proxy's button
    // is captioned to say so.
    const dropped = await collection.deleteMany({});
    console.log(`--force: dropped all ${dropped.deletedCount} reports, ${community} of them entered by people.`);
  } else {
    const dropped = await collection.deleteMany({ source: "example" });
    console.log(`removed ${dropped.deletedCount} old example reports; kept ${community} entered by people.`);
  }

  if (flag("clear")) {
    console.log("--clear: nothing written.");
    console.log(`reports now: ${await collection.countDocuments({})}`);
    return 0;
  }

  const reports = buildSeedReports({
    total: number("count", DEFAULT_SEED_TOTAL),
    seed: number("seed", 20260904),
    days: number("days", 120),
  });

  if (reports.length === 0) {
    console.log("nothing to write.");
    return 0;
  }

  // One ordered:false bulk write: a duplicate id from a re-run should not stop
  // the rest, and 180 individual round trips is 180 round trips.
  await collection.bulkWrite(
    reports.map((report) => ({
      updateOne: { filter: { id: report.id }, update: { $set: toDoc(report) }, upsert: true },
    })),
    { ordered: false },
  );

  const after = await collection.countDocuments({});
  const examples = await collection.countDocuments({ source: "example" });
  const sample = await collection.findOne({ source: "example" });

  console.log("");
  console.log(`wrote ${reports.length} EXAMPLE reports.  ${before} → ${after} total, ${examples} of them example data.`);
  if (sample) console.log(`sample: ${JSON.stringify(fromDoc(sample))}`);
  console.log("");
  console.log("⚠ None of this happened. It is generated data so the crime filter can be");
  console.log("  demonstrated before the interviews exist. The app draws every one of these");
  console.log("  as a hollow dashed marker, says EXAMPLE DATA in its popup, and shows a");
  console.log("  banner in the panel while any are loaded.");
  console.log("  Clear them from the panel, or with:  npm run seed -- --clear");
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
