/**
 * `node scripts/import-interviews.ts <file.json | folder> ...`
 *
 * Load interview transcripts (Whisper JSON: `{language, duration, segments}`)
 * into the database. The team files them as `Interview <n> <name>/…json`, so
 * the number becomes the code (`P0<n>`) and the label, and the name becomes
 * `participant` — shown only to a signed-in member of the team.
 *
 * Replaces an interview with the same id, so running it twice changes nothing.
 * Needs `MONGO_URI`, as `import-pointer.ts` does. The transcripts are never
 * committed: real participants, under a consent form, in a public repository
 * is exactly the leak this app is built to avoid.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { interviewsCollection, mongoUri, toInterviewDoc } from "../src/lib/db.ts";
import { parseInterview, parseWhisper } from "../src/lib/interviews.ts";

function jsonFiles(path: string): string[] {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).flatMap((name) => jsonFiles(join(path, name)));
  }
  return path.toLowerCase().endsWith(".json") ? [path] : [];
}

/** "Interview 2 (matilde)" → { number: 2, name: "Matilde" }. */
function fromName(text: string): { number: number; name: string } | null {
  const match = text.match(/interview\s*(\d+)\s*[-_(]*\s*([^)]*)\)?/i);
  if (!match) return null;
  const name = (match[2] ?? "").replace(/\.json$/i, "").trim();
  return { number: Number(match[1]), name: name ? name[0]!.toUpperCase() + name.slice(1) : "" };
}

async function main(): Promise<number> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("usage: node scripts/import-interviews.ts <file.json | folder> ...");
    return 2;
  }
  if (!mongoUri()) {
    console.error("MONGO_URI is not set — there is no database to import into.");
    return 1;
  }
  const collection = await interviewsCollection();
  if (!collection) return 1;

  let written = 0;
  for (const file of paths.flatMap(jsonFiles)) {
    const named = fromName(basename(dirname(file))) ?? fromName(basename(file));
    if (!named) {
      console.log(`skipped ${file}: the folder or file name does not say which interview it is`);
      continue;
    }
    const transcript = parseWhisper(readFileSync(file, "utf8"));
    const code = `P${String(named.number).padStart(2, "0")}`;
    const interview = parseInterview({
      id: `interview-${named.number}`,
      code,
      label: `Interview ${named.number}`,
      participant: named.name,
      ...transcript,
      source: "fieldwork",
      addedAt: new Date().toISOString(),
    });
    if (!interview) {
      console.log(`skipped ${file}: not a usable transcript`);
      continue;
    }
    await collection.replaceOne({ id: interview.id }, toInterviewDoc(interview), { upsert: true });
    written++;
    console.log(`${code}  ${interview.label} (${interview.participant})  ${interview.segments.length} segments, ${Math.round((interview.durationSec ?? 0) / 60)} min`);
  }
  console.log(`imported ${written} interview(s); ${await collection.countDocuments({})} in the database`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
