/**
 * The crime layer's storage.
 *
 * The second API route in this app, and it exists for the same kind of reason
 * as the first: the browser cannot hold the connection string, and reports are
 * the one thing here that has to outlive the tab that typed them.
 *
 * `backend` in every reply is the important field. `"mongo"` means these
 * reports are shared by everyone using this instance; `"browser"` means no
 * `MONGO_URI` is configured, the server stored nothing, and the page must keep
 * them locally instead. The page prints which — a report someone believed they
 * had filed, held only in their own browser, is worse than no report at all.
 */

import { NextResponse } from "next/server";

import { fromDoc, reportsCollection, toDoc } from "@/lib/db";
import { MAX_REPORTS, parseReports, type Report } from "@/lib/reports";

// The reports change; a cached list would show a stale map.
export const dynamic = "force-dynamic";

/** A ceiling on one reply, so a seeded instance cannot ship megabytes. */
const PAGE = 2_000;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  let collection;
  try {
    collection = await reportsCollection();
  } catch {
    // A configured but unreachable database is an error, not an empty map.
    return fail("The reports database is configured but could not be reached.", 503);
  }
  if (!collection) {
    return NextResponse.json({ backend: "browser", reports: [] });
  }

  const docs = await collection.find({}, { sort: { atMs: -1 }, limit: PAGE }).toArray();
  return NextResponse.json({ backend: "mongo", reports: docs.map(fromDoc) });
}

/**
 * Add one report.
 *
 * The body is re-validated with the same parser the browser uses rather than
 * trusted: this is a public endpoint, and `source` in particular is forced to
 * `community` — nothing outside `npm run seed` may write a point marked as
 * example data, and nothing may launder an example point into a real one.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Unreadable request body.", 400);
  }

  const candidate = (body as { report?: unknown })?.report;
  const [report] = parseReports([candidate]);
  if (!report) return fail("That is not a report this app can store.", 400);

  const stored: Report = { ...report, source: "community" };
  delete (stored as { area?: string }).area;

  let collection;
  try {
    collection = await reportsCollection();
  } catch {
    return fail("The reports database is configured but could not be reached.", 503);
  }
  if (!collection) {
    // Nothing was stored, and the page has to know that to keep its own copy.
    return NextResponse.json({ backend: "browser", report: stored });
  }

  const total = await collection.estimatedDocumentCount();
  if (total >= MAX_REPORTS * 40) {
    return fail("This instance is holding as many reports as it will take.", 507);
  }

  await collection.updateOne({ id: stored.id }, { $set: toDoc(stored) }, { upsert: true });
  return NextResponse.json({ backend: "mongo", report: stored });
}

/**
 * Delete one report, or every example report at once.
 *
 * `?examples=all` is the panel's "clear the example data" button. It deletes
 * only `source: "example"` — a community report is never swept up by it, and
 * there is no endpoint that deletes everything.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const examples = url.searchParams.get("examples");
  if (!id && examples !== "all") return fail("Nothing named to delete.", 400);

  let collection;
  try {
    collection = await reportsCollection();
  } catch {
    return fail("The reports database is configured but could not be reached.", 503);
  }
  if (!collection) return NextResponse.json({ backend: "browser", deleted: 0 });

  const result = examples === "all"
    ? await collection.deleteMany({ source: "example" })
    : await collection.deleteOne({ id: id ?? "" });

  return NextResponse.json({ backend: "mongo", deleted: result.deletedCount ?? 0 });
}
