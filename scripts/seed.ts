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
 *   npm run seed              wipe the database, then write the example data
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
 * WHAT IT WRITES IS MADE UP. Every record carries `source: "example"`, and the
 * app marks those differently everywhere they appear — see `src/lib/seed-data.ts`
 * and `src/lib/seed-interviews.ts` for why that is not decoration. This exists
 * so the filters, the map and the research panel can be demonstrated before the
 * interviews are done, and it is meant to be cleared when they are: one click
 * in the panel, or `npm run seed -- --no-demo`.
 *
 * TWO COLLECTIONS, NEVER ONE:
 *
 *   `reports`     — points on the crime layer. Placeholder notes only.
 *   `interviews`  — synthetic participants answering the protocol's questions.
 *
 * They are kept apart because the seed writes invented material into the
 * second, and an invented quote must never end up in the same collection as a
 * real one. Do not "simplify" this into one collection with a `kind` field.
 */

import {
  fromDoc, mongoUri, databaseName, db, interviewsCollection, INTERVIEWS,
  reportsCollection, REPORTS, toDoc, toInterviewDoc,
} from "../src/lib/db.ts";
import { resolveSeedFlags } from "../src/lib/seed-flags.ts";
import { buildSeedReports, DEFAULT_SEED_TOTAL } from "../src/lib/seed-data.ts";
import { buildSeedInterviews, DEFAULT_INTERVIEW_TOTAL } from "../src/lib/seed-interviews.ts";

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

  // Same rule, same reason: built before the wipe, so a generator that throws
  // cannot leave the database empty. `--count` deliberately does NOT size this
  // — it means example REPORTS, and a cohort is a fixed set of written
  // participants rather than a number to dial. `DEFAULT_INTERVIEW_TOTAL` is
  // however many are in the table.
  const interviews = flags.demo
    ? buildSeedInterviews({ total: DEFAULT_INTERVIEW_TOTAL, days: 45 })
    : [];

  const collection = await reportsCollection();
  if (!collection) {
    console.error("Could not open the reports collection.");
    return 1;
  }

  const before = await collection.countDocuments({});
  const community = await collection.countDocuments({ source: "community" });

  const interviewsBefore = await interviewsCollection();
  if (!interviewsBefore) {
    console.error("Could not open the interviews collection.");
    return 1;
  }
  const interviewsWere = await interviewsBefore.countDocuments({});
  // Interviews from actual fieldwork. Counted BEFORE the wipe and named in the
  // log, because these are transcripts of a sitting somebody consented to and
  // there is no other copy — the same cost as a community report, and higher
  // per record.
  const fieldwork = await interviewsBefore.countDocuments({ source: "fieldwork" });

  // ── Wipe ──────────────────────────────────────────────────────────────────
  if (flags.keep) {
    const dropped = await collection.deleteMany({ source: "example" });
    console.log(`--keep: removed ${dropped.deletedCount} old example reports; kept ${community} entered by people.`);
    // The same on the other collection, and `source: "example"` is the filter
    // for the same reason: a real transcript must survive a --keep seed.
    const droppedInterviews = await interviewsBefore.deleteMany({ source: "example" });
    console.log(
      `--keep: removed ${droppedInterviews.deletedCount} old example interviews; ` +
        `kept ${fieldwork} from fieldwork.`,
    );
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
        `${community} of them entered by people, ${interviewsWere} interviews, ` +
        `${fieldwork} of them from fieldwork.  [${names.join(" ") || "empty"}]`,
    );
    if (fieldwork > 0) {
      // Loud, and on its own line. A dropped transcript is not recoverable and
      // the person reading this log tail pressed a button seconds ago.
      console.log(
        `⚠  ${fieldwork} interview(s) from REAL FIELDWORK are about to be dropped. ` +
          `--keep would have spared them.`,
      );
    }
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

  // And the interviews collection's own indexes — unique `id`, unique `code`,
  // `source`, `atMs`. Asking for the collection is what rebuilds them.
  const rebuiltInterviews = await interviewsCollection();
  if (!rebuiltInterviews) {
    console.error("Could not reopen the interviews collection after the wipe.");
    return 1;
  }
  const interviewIndexes = await rebuiltInterviews.indexes();
  console.log(`indexes on ${INTERVIEWS}: ${interviewIndexes.map((index) => index.name).join(", ")}`);

  if (interviews.length > 0) {
    await rebuiltInterviews.bulkWrite(
      interviews.map((interview) => ({
        updateOne: {
          filter: { id: interview.id },
          update: { $set: toInterviewDoc(interview) },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  if (reports.length === 0 && interviews.length === 0) {
    console.log(flags.demo ? "nothing to write." : "no example data written (--no-demo).");
    console.log(`reports now: ${await rebuilt.countDocuments({})}`);
    console.log(`interviews now: ${await rebuiltInterviews.countDocuments({})}`);
    return 0;
  }

  // One ordered:false bulk write: a duplicate id from a re-run should not stop
  // the rest, and 180 individual round trips is 180 round trips.
  if (reports.length > 0) {
    await rebuilt.bulkWrite(
      reports.map((report) => ({
        updateOne: { filter: { id: report.id }, update: { $set: toDoc(report) }, upsert: true },
      })),
      { ordered: false },
    );
  }

  const after = await rebuilt.countDocuments({});
  const examples = await rebuilt.countDocuments({ source: "example" });
  const remaining = await rebuilt.countDocuments({ source: "community" });
  const sample = await rebuilt.findOne({ source: "example" });

  const interviewsNow = await rebuiltInterviews.countDocuments({});
  const exampleInterviews = await rebuiltInterviews.countDocuments({ source: "example" });
  const fieldworkNow = await rebuiltInterviews.countDocuments({ source: "fieldwork" });

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
  console.log(`  🎙  INTERVIEWS          ${interviewsWere} → ${interviewsNow}`);
  console.log(`      synthetic           ${exampleInterviews}   (wrote ${interviews.length})`);
  console.log(`      from fieldwork      ${fieldworkNow}${flags.keep ? "  (kept)" : ""}`);
  if (interviews.length > 0) {
    // What the cohort actually contains, because the value of this data is its
    // spread and an operator cannot see that from a count. These are the
    // numbers the research panel shows, printed here so a reseed can be
    // sanity-checked from the log tail alone.
    const cohort = interviews.map((one) => one.demographics);
    const cities = new Set(cohort.map((one) => one.city)).size;
    const ages = new Set(cohort.map((one) => one.ageBand)).size;
    const modes = new Set(cohort.map((one) => one.mainMode)).size;
    const identity = cohort.filter((one) => one.identityNote).length;
    const contributors = interviews.filter((one) => one.needs.wouldContribute).length;
    const neutral = interviews.filter((one) => one.needs.prefersNeutral).length;
    console.log(`      spread              ${cities} cities · ${ages} age bands · ${modes} main modes`);
    console.log(`      answered §10 opt-in ${identity} of ${interviews.length}  (the rest skipped it, as allowed)`);
    console.log(`      would contribute    ${contributors} yes / ${interviews.length - contributors} no`);
    console.log(`      prefer no profiling ${neutral}`);
  }
  console.log("");
  // The record of which rows are placeholders. This is a log read by whoever
  // pressed the button, not a label on the product — and with the on-screen
  // marking off (see src/lib/demo-mode.ts) it is the ONLY place that says so,
  // which is why it stays.
  console.log("  ℹ  PLACEHOLDER DATA. None of it happened and nobody said it. It is here so");
  console.log("     the crime layer and the research panel can be evaluated before the");
  console.log("     fieldwork is in.");
  console.log("");
  console.log("     MARK_EXAMPLE_DATA is OFF, so it renders exactly as real data will —");
  console.log("     solid markers, ordinary popups, no banners. Nothing on screen tells");
  console.log("     these rows from real ones. Every row still carries source:\"example\"");
  console.log("     in the database, which is how they are found again.");
  console.log("");
  console.log("     Clear before anyone outside the team sees it:  npm run seed -- --no-demo");
  console.log("     Put the on-screen marking back:               MARK_EXAMPLE_DATA = true");
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
