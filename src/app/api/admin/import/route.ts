/**
 * Import a Pointer "Onveilige plekken" export (the `.csv` they send) straight
 * into the database. Team only. The file is parsed here and not kept: from
 * this point the database is where the data lives.
 *
 * Upserts by Pointer's `locatie_id`, so importing a newer export updates what
 * changed and adds what is new; rows missing from the newer file are left
 * alone — absence is not a deletion.
 */

import { NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/auth";
import { datasetsCollection, reportsCollection } from "@/lib/db";
import { recordPointerDataset, upsertReports } from "@/lib/importer";
import { parsePointerCsv } from "@/lib/pointer";

export const dynamic = "force-dynamic";

/** Pointer's export is ~6 MB; leave room for it to grow. */
const MAX_BYTES = 40 * 1024 * 1024;

export async function POST(request: Request) {
  const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status });
  if (!isAdminRequest(request)) return fail("Sign in first.", 401);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return fail("That file is too large.", 413);

  const text = await request.text();
  let parsed;
  try {
    parsed = parsePointerCsv(text);
  } catch (caught) {
    return fail(caught instanceof Error ? caught.message : "That file could not be read.", 400);
  }
  if (parsed.reports.length === 0) return fail("That export has no usable rows.", 400);

  let collection;
  let sets;
  try {
    collection = await reportsCollection();
    sets = await datasetsCollection();
  } catch {
    return fail("The reports database is configured but could not be reached.", 503);
  }
  if (!collection || !sets) return fail("No database is configured (MONGO_URI).", 503);

  const result = await upsertReports(collection, parsed.reports);
  const url = new URL(request.url);
  await recordPointerDataset(collection, sets, {
    version: (url.searchParams.get("version") ?? "").trim().slice(0, 80),
    exportedAt: (url.searchParams.get("exportedAt") ?? "").trim().slice(0, 40),
  });
  return NextResponse.json({
    read: parsed.reports.length,
    inserted: result.inserted,
    updated: result.updated,
    skipped: parsed.skipped.slice(0, 50),
    skippedTotal: parsed.skipped.length,
  });
}
