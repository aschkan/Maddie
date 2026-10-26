/**
 * The study team's view of the reports: search, add, correct, delete. Every
 * method needs the `/admin` session.
 *
 * A report added here is `source: "admin"`. A correction keeps the record's
 * own source — fixing a typo in a Pointer row does not make it the team's.
 */

import { NextResponse } from "next/server";
import type { Collection } from "mongodb";

import { isAdminRequest } from "@/lib/auth";
import { fromDoc, reportsCollection, toDoc, type ReportDoc } from "@/lib/db";
import { parseReport, type Report, type ReportSource } from "@/lib/reports";

export const dynamic = "force-dynamic";

const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status });

async function open(): Promise<{ collection: Collection<ReportDoc> } | { error: NextResponse }> {
  try {
    const collection = await reportsCollection();
    return collection ? { collection } : { error: fail("No database is configured (MONGO_URI).", 503) };
  } catch {
    return { error: fail("The reports database is configured but could not be reached.", 503) };
  }
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return fail("Sign in first.", 401);
  const opened = await open();
  if ("error" in opened) return opened.error;
  const { collection } = opened;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const source = url.searchParams.get("source");
  const skip = Math.max(0, Number(url.searchParams.get("skip")) || 0);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));

  const filter: Record<string, unknown> = {};
  if (source === "pointer" || source === "admin" || source === "community") filter.source = source;
  if (q) {
    const rx = { $regex: escapeRegex(q), $options: "i" };
    filter.$or = [{ place: rx }, { note: rx }, { id: rx }];
  }
  const [docs, total, bySource] = await Promise.all([
    collection.find(filter, { sort: { atMs: -1 }, skip, limit }).toArray(),
    collection.countDocuments(filter),
    collection.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$source", n: { $sum: 1 } } }]).toArray(),
  ]);
  return NextResponse.json({
    reports: docs.map(fromDoc).filter((x): x is Report => x !== null),
    total,
    counts: Object.fromEntries(bySource.map((row) => [row._id, row.n])),
  });
}

function fromBody(body: unknown, source: ReportSource, id: string): Report | null {
  const raw = (body as { report?: Record<string, unknown> })?.report;
  if (!raw || typeof raw !== "object") return null;
  const reasons = Array.isArray(raw.reasons) ? raw.reasons : [];
  return parseReport({
    ...raw,
    id,
    source,
    category: typeof reasons[0] === "string" ? reasons[0] : "other",
  });
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return fail("Sign in first.", 401);
  const body = await readBody(request);
  const id = `admin-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const report = fromBody(body, "admin", id);
  if (!report) return fail("A report needs a point on the map and a date.", 400);

  const opened = await open();
  if ("error" in opened) return opened.error;
  await opened.collection.insertOne(toDoc(report));
  return NextResponse.json({ report });
}

export async function PUT(request: Request) {
  if (!isAdminRequest(request)) return fail("Sign in first.", 401);
  const body = await readBody(request);
  const id = String((body as { report?: { id?: unknown } } | null)?.report?.id ?? "");
  const opened = await open();
  if ("error" in opened) return opened.error;
  const existing = await opened.collection.findOne({ id });
  if (!existing) return fail("No report with that id.", 404);
  const report = fromBody(body, existing.source, id);
  if (!report) return fail("That is not a report this app can store.", 400);
  await opened.collection.replaceOne({ id }, toDoc(report));
  return NextResponse.json({ report });
}

export async function DELETE(request: Request) {
  if (!isAdminRequest(request)) return fail("Sign in first.", 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return fail("Nothing named to delete.", 400);
  const opened = await open();
  if ("error" in opened) return opened.error;
  const result = await opened.collection.deleteOne({ id });
  return NextResponse.json({ deleted: result.deletedCount ?? 0 });
}
