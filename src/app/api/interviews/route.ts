/**
 * The interviews, read-only — and ONLY for a signed-in member of the team.
 *
 * These are real participants under a consent form, so this route answers 401
 * to anybody without the `/admin` session cookie. Writes are not here: they go
 * through `/api/admin/interviews`, which needs the same session.
 *
 * `backend`: `"mongo"` when `MONGO_URI` is set, `"none"` when it is not —
 * there is no browser fallback, because a browser could never have produced a
 * transcript, and an empty list must not read as a study with no participants.
 */

import { NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/auth";
import { fromInterviewDoc, interviewsCollection } from "@/lib/db";
import { parseInterviews } from "@/lib/interviews";

export const dynamic = "force-dynamic";

const PAGE = 500;

export async function GET(request: Request) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Sign in at /admin to read the interviews." }, { status: 401 });
  }
  let collection;
  try {
    collection = await interviewsCollection();
  } catch {
    return NextResponse.json(
      { error: "The interview database is configured but could not be reached." },
      { status: 503 },
    );
  }
  if (!collection) return NextResponse.json({ backend: "none", interviews: [] });

  const docs = await collection.find({}, { sort: { code: 1 }, limit: PAGE }).toArray();
  const interviews = parseInterviews(docs.map(fromInterviewDoc));
  return NextResponse.json({ backend: "mongo", interviews });
}
