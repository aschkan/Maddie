/**
 * The reports layer's storage.
 *
 * `backend` in every reply is the important field. `"mongo"` means these
 * reports are shared by everyone using this instance; `"browser"` means no
 * `MONGO_URI` is configured, the server stored nothing, and the page must keep
 * them locally instead. The page prints which.
 *
 * GET is scoped to a circle (`?lat&lng&r`, metres) because the database holds
 * the whole Pointer survey — 18k places across the Netherlands — and a board
 * shows one city. `datasets` rides along so every board can print where the
 * figures came from (Pointer must be credited wherever its data is shown).
 *
 * POST is public and writes `source: "community"` only — nothing over this
 * route can claim to be Pointer's data or the study team's. DELETE needs a
 * signed-in team session: the collection is real data with no other copy.
 */

import { NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/auth";
import { datasetsCollection, fromDoc, reportsCollection, toDoc } from "@/lib/db";
import { parseReport, type Report } from "@/lib/reports";

// The reports change; a cached list would show a stale map.
export const dynamic = "force-dynamic";

/** A ceiling on one reply. Amsterdam within 9 km is ~2.4k. */
const PAGE = 8_000;
const MAX_RADIUS_M = 30_000;
/** A community note is a sentence or two, not a survey story. */
const COMMUNITY_NOTE = 1_000;
/** Ceiling on the whole collection, so the public POST cannot fill the disk. */
const MAX_STORED = 100_000;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

const UNREACHABLE = "The reports database is configured but could not be reached.";

export async function GET(request: Request) {
  let collection;
  try {
    collection = await reportsCollection();
  } catch {
    // A configured but unreachable database is an error, not an empty map.
    return fail(UNREACHABLE, 503);
  }
  if (!collection) return NextResponse.json({ backend: "browser", reports: [] });

  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const r = Math.min(MAX_RADIUS_M, Math.max(100, Number(url.searchParams.get("r")) || 9_000));
  const scoped = url.searchParams.has("lat") && Number.isFinite(lat) && Number.isFinite(lng);

  const filter = scoped
    ? { loc: { $geoWithin: { $centerSphere: [[lng, lat], r / 6_378_100] } } }
    : {};
  const docs = await collection.find(filter, { sort: { atMs: -1 }, limit: PAGE }).toArray();
  const reports = docs.map(fromDoc).filter((x): x is Report => x !== null);

  let datasets: unknown[] = [];
  try {
    const sets = await datasetsCollection();
    datasets = sets ? await sets.find({}, { projection: { _id: 0 } }).toArray() : [];
  } catch {
    // Provenance is printed when it can be read; the reports do not wait on it.
  }
  return NextResponse.json({ backend: "mongo", reports, truncated: docs.length === PAGE, datasets });
}

/**
 * Add one community report. Re-validated with the same parser the browser
 * uses rather than trusted, and stripped of every field only a dataset carries.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Unreadable request body.", 400);
  }

  const report = parseReport((body as { report?: unknown })?.report);
  if (!report) return fail("That is not a report this app can store.", 400);

  const stored: Report = {
    id: report.id,
    category: report.category,
    point: report.point,
    at: report.at,
    source: "community",
    ...(report.reasons ? { reasons: report.reasons } : {}),
    ...(report.when ? { when: report.when } : {}),
    ...(report.adjustments ? { adjustments: report.adjustments } : {}),
    ...(report.note ? { note: report.note.slice(0, COMMUNITY_NOTE) } : {}),
  };
  if (!/^r[a-z0-9]{4,30}$/.test(stored.id)) return fail("That is not a report this app can store.", 400);

  let collection;
  try {
    collection = await reportsCollection();
  } catch {
    return fail(UNREACHABLE, 503);
  }
  // Nothing was stored, and the page has to know that to keep its own copy.
  if (!collection) return NextResponse.json({ backend: "browser", report: stored });

  if ((await collection.estimatedDocumentCount()) >= MAX_STORED) {
    return fail("This instance is holding as many reports as it will take.", 507);
  }
  // Insert only: an id that exists is never overwritten from a public route.
  const result = await collection.updateOne({ id: stored.id }, { $setOnInsert: toDoc(stored) }, { upsert: true });
  if (result.upsertedCount === 0) return fail("A report with that id already exists.", 409);
  return NextResponse.json({ backend: "mongo", report: stored });
}

/** Delete one report — team only. Everything here is real and has no other copy. */
export async function DELETE(request: Request) {
  if (!isAdminRequest(request)) return fail("Sign in at /admin to delete reports.", 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return fail("Nothing named to delete.", 400);

  let collection;
  try {
    collection = await reportsCollection();
  } catch {
    return fail(UNREACHABLE, 503);
  }
  if (!collection) return NextResponse.json({ backend: "browser", deleted: 0 });
  const result = await collection.deleteOne({ id });
  return NextResponse.json({ backend: "mongo", deleted: result.deletedCount ?? 0 });
}
