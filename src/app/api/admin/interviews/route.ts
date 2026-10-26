/**
 * Add, correct and remove interviews. Team only — these are real participants
 * under a consent form. Reading is `/api/interviews` (same session).
 *
 * A transcript arrives as Whisper JSON (`segments` with timings — what the
 * team's transcription produces) or as plain text, one line per turn.
 */

import { NextResponse } from "next/server";
import type { Collection } from "mongodb";

import { isAdminRequest } from "@/lib/auth";
import { interviewsCollection, toInterviewDoc, type InterviewDoc } from "@/lib/db";
import {
  MAX_NOTES, nextCode, parseInterview, parseWhisper, segmentsFromText, type Segment,
} from "@/lib/interviews";

export const dynamic = "force-dynamic";

const fail = (message: string, status: number) => NextResponse.json({ error: message }, { status });

interface Body {
  id?: unknown;
  label?: unknown;
  participant?: unknown;
  conductedAt?: unknown;
  interviewer?: unknown;
  notes?: unknown;
  /** Whisper JSON, as text. */
  whisper?: unknown;
  /** Plain transcript text. */
  text?: unknown;
}

const s = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function transcriptFrom(body: Body): { segments: Segment[]; language?: string; durationSec?: number } | null {
  const whisper = s(body.whisper, 20_000_000);
  if (whisper) return parseWhisper(whisper);
  const text = s(body.text, 5_000_000);
  if (text) return { segments: segmentsFromText(text) };
  return null;
}

async function open(): Promise<{ collection: Collection<InterviewDoc> } | { error: NextResponse }> {
  try {
    const collection = await interviewsCollection();
    return collection ? { collection } : { error: fail("No database is configured (MONGO_URI).", 503) };
  } catch {
    return { error: fail("The interview database is configured but could not be reached.", 503) };
  }
}

async function readBody(request: Request): Promise<Body | null> {
  try {
    return (await request.json()) as Body;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isAdminRequest(request)) return fail("Sign in first.", 401);
  const body = await readBody(request);
  if (!body) return fail("Unreadable request body.", 400);
  let transcript;
  try {
    transcript = transcriptFrom(body);
  } catch (caught) {
    return fail(caught instanceof Error ? caught.message : "That transcript could not be read.", 400);
  }
  if (!transcript || transcript.segments.length === 0) {
    return fail("Add the transcript — a Whisper JSON file or pasted text.", 400);
  }

  const opened = await open();
  if ("error" in opened) return opened.error;
  const existing = await opened.collection.find({}, { projection: { code: 1, id: 1 } }).toArray();
  const code = nextCode(existing.map((doc) => doc.code));
  const number = Number(code.slice(1));
  const interview = parseInterview({
    id: `interview-${number}`,
    code,
    label: s(body.label, 120) || `Interview ${number}`,
    participant: s(body.participant, 120),
    conductedAt: s(body.conductedAt, 40),
    interviewer: s(body.interviewer, 120),
    notes: s(body.notes, MAX_NOTES),
    ...transcript,
    source: "fieldwork",
    addedAt: new Date().toISOString(),
  });
  if (!interview) return fail("That interview could not be stored.", 400);
  if (existing.some((doc) => doc.id === interview.id)) return fail("An interview with that number already exists.", 409);
  await opened.collection.insertOne(toInterviewDoc(interview));
  return NextResponse.json({ interview });
}

/** Correct the details; a new transcript, when sent, replaces the old one. */
export async function PUT(request: Request) {
  if (!isAdminRequest(request)) return fail("Sign in first.", 401);
  const body = await readBody(request);
  if (!body) return fail("Unreadable request body.", 400);
  const opened = await open();
  if ("error" in opened) return opened.error;
  const id = s(body.id, 80);
  const current = await opened.collection.findOne({ id }, { projection: { _id: 0, atMs: 0 } });
  if (!current) return fail("No interview with that id.", 404);

  let transcript;
  try {
    transcript = transcriptFrom(body);
  } catch (caught) {
    return fail(caught instanceof Error ? caught.message : "That transcript could not be read.", 400);
  }
  const updated = parseInterview({
    ...current,
    label: s(body.label, 120) || current.label,
    participant: s(body.participant, 120),
    conductedAt: s(body.conductedAt, 40),
    interviewer: s(body.interviewer, 120),
    notes: s(body.notes, MAX_NOTES),
    ...(transcript ?? {}),
  });
  if (!updated) return fail("That interview could not be stored.", 400);
  await opened.collection.replaceOne({ id }, toInterviewDoc(updated));
  return NextResponse.json({ interview: updated });
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
