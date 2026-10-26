/**
 * `node scripts/import-pointer.ts <export.csv> [--version=<hash>] [--exported=<YYYY-MM-DD>]`
 *
 * Load a Pointer "Onveilige plekken" export into the database, once. After
 * this the CSV is not needed by anything — the database is where the data
 * lives, the seed rebuilds from it, and a newer export goes in the same way
 * (or through Import in /admin). Upserts by Pointer's `locatie_id`: running it
 * twice changes nothing.
 *
 * Needs `MONGO_URI` in the environment, exactly as the app gets it. On a box:
 *   set -a; . ./.env; set +a; node scripts/import-pointer.ts ~/Pointer.csv
 *
 * ⚠ The CSV is never committed: this repository is public, and Pointer hands
 * the data out for non-commercial use with a credit (`POINTER_CREDIT`).
 */

import { readFileSync } from "node:fs";

import { datasetsCollection, mongoUri, reportsCollection } from "../src/lib/db.ts";
import { recordPointerDataset, upsertReports } from "../src/lib/importer.ts";
import { parsePointerCsv, POINTER_CREDIT } from "../src/lib/pointer.ts";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
  if (!file) {
    console.error("usage: node scripts/import-pointer.ts <export.csv> [--version=<hash>] [--exported=<YYYY-MM-DD>]");
    return 2;
  }
  if (!mongoUri()) {
    console.error("MONGO_URI is not set — there is no database to import into.");
    return 1;
  }

  const parsed = parsePointerCsv(readFileSync(file, "utf8"));
  console.log(`read ${parsed.reports.length} places from ${file}`);
  for (const skip of parsed.skipped.slice(0, 20)) console.log(`  skipped line ${skip.line}: ${skip.why}`);
  if (parsed.skipped.length > 20) console.log(`  …and ${parsed.skipped.length - 20} more skipped`);

  const reports = await reportsCollection();
  const datasets = await datasetsCollection();
  if (!reports || !datasets) {
    console.error("Could not open the collections.");
    return 1;
  }
  const result = await upsertReports(reports, parsed.reports, (done, total) => {
    if (done % 5_000 < 500 || done === total) console.log(`  ${done}/${total}`);
  });
  await recordPointerDataset(reports, datasets, { version: option("version"), exportedAt: option("exported") });
  console.log(`inserted ${result.inserted}, updated ${result.updated}`);
  console.log(`pointer rows now in the database: ${await reports.countDocuments({ source: "pointer" })}`);
  console.log(`credit (show it wherever this data is used): ${POINTER_CREDIT}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
