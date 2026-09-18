/**
 * The requirements interviews, read-only.
 *
 * The third API route, and it exists for the same reason as the other two: the
 * browser cannot hold the connection string. Everything else about it is
 * narrower than `/api/reports` on purpose.
 *
 * ⚠ **THERE IS NO POST, AND THERE MUST NOT BE ONE.** An interview is produced
 * in a room, with a consent form signed first — §1 of the protocol — and
 * transcribed afterwards. A public endpoint that accepted one would be a way
 * for anybody to write a "participant" into the study's own data, which is a
 * worse version of the problem `POST /api/reports` already guards against by
 * forcing `source: "community"`. Interviews get in through `npm run seed`
 * (synthetic) or, when the fieldwork is done, whatever import the researcher
 * runs by hand. Not over HTTP.
 *
 * `backend` in the reply says which store answered, exactly as the reports
 * route does: `"mongo"` when `MONGO_URI` is set, `"none"` when it is not —
 * there is no browser fallback here, because an interview is not something a
 * visitor's browser could ever have produced. A deployment without a database
 * has no interviews at all, and the panel says so rather than showing an empty
 * list that reads like a study with no participants in it.
 */

import { NextResponse } from "next/server";

import { fromInterviewDoc, interviewsCollection } from "@/lib/db";
import { parseInterviews } from "@/lib/interviews";

// The panel reads this after a reseed; a cached list would show the old cohort.
export const dynamic = "force-dynamic";

/**
 * A ceiling on one reply.
 *
 * Generous relative to the real number — a study of this shape is tens of
 * participants, not thousands — but each record is large, so an unbounded
 * reply on a seeded instance is a multi-megabyte page load.
 */
const PAGE = 500;

export async function GET() {
  let collection;
  try {
    collection = await interviewsCollection();
  } catch {
    // Configured but unreachable is an error, never an empty cohort. The same
    // rule as the reports route: an empty list here would read as "the
    // interviews found nothing", which is a claim about the research.
    return NextResponse.json(
      { error: "The interview database is configured but could not be reached." },
      { status: 503 },
    );
  }

  if (!collection) {
    return NextResponse.json({ backend: "none", interviews: [] });
  }

  const docs = await collection.find({}, { sort: { atMs: 1 }, limit: PAGE }).toArray();
  // Re-parsed on the way out rather than trusted: these rows were written by a
  // seed or by an import script, and a row from an older shape of this app
  // must not reach the panel half-formed. `parseInterviews` drops what does
  // not survive and defaults `source` to "example", which is the safe way
  // round for this collection.
  const interviews = parseInterviews(docs.map(fromInterviewDoc));
  return NextResponse.json({ backend: "mongo", interviews });
}
