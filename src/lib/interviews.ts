/**
 * The study's interviews — real transcripts, as recorded. Pure, tested.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THESE ARE REAL PEOPLE UNDER A CONSENT FORM. They are shown ONLY to a     │
 * │ signed-in member of the study team (`/research`, `/admin`), never on a  │
 * │ public page, never on the map, and never in the public repository.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * The first version of this file held a synthetic cohort of 24 invented
 * participants, shaped section by section like `Interview_Protocol_Revised_3`.
 * It is gone: the four interviews that were actually held replaced it, and
 * there is no invented data in this app any more.
 *
 * What an interview IS here: the transcript as the transcription produced it
 * (Whisper segments with their timings, or plain text pasted in /admin), plus
 * who and when as the team files it. What it is NOT: coded. Grouping what was
 * said into the protocol's sections, or into themes, is qualitative coding — a
 * research step with a method behind it — and doing it by string matching here
 * would manufacture findings. The transcript is searchable; coding stays with
 * the researchers.
 *
 * The rules that carry over from the first version, because the reasons did:
 *
 *   * **Its own collection, never `reports`.** A participant is not a place, and
 *     no coordinate is ever stored on an interview.
 *   * **No public write.** Interviews arrive by `scripts/import-interviews.ts`
 *     or through `/api/admin/interviews`, which needs a signed-in session.
 *   * **`source: "example"` is dropped on read**, never promoted to fieldwork.
 */

export interface Segment {
  /** Seconds from the start of the recording; null when pasted as plain text. */
  start: number | null;
  end: number | null;
  text: string;
}

export interface Interview {
  /** Stable id, e.g. `interview-1`. */
  id: string;
  /** How the team refers to the participant in writing: P01, P02… Unique. */
  code: string;
  /** "Interview 1". */
  label: string;
  /** The name or pseudonym the team filed it under. Team-only. */
  participant?: string;
  /** ISO date the interview was held, when known. */
  conductedAt?: string;
  interviewer?: string;
  /** ISO 639-1, as the transcription detected it. */
  language?: string;
  /** Recording length, when known. */
  durationSec?: number;
  segments: Segment[];
  /** The team's own notes about the session. Not part of the transcript. */
  notes?: string;
  source: "fieldwork";
  /** When this record was added to the database. */
  addedAt: string;
}

export const MAX_SEGMENTS = 5_000;
export const MAX_SEGMENT_TEXT = 4_000;
export const MAX_NOTES = 20_000;

const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

export function parseSegments(raw: unknown): Segment[] {
  if (!Array.isArray(raw)) return [];
  const out: Segment[] = [];
  for (const entry of raw.slice(0, MAX_SEGMENTS)) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const text = str(item.text, MAX_SEGMENT_TEXT);
    if (!text) continue;
    out.push({ start: num(item.start), end: num(item.end), text });
  }
  return out;
}

/** One stored or submitted record → an interview, or null when it is not one. */
export function parseInterview(entry: unknown): Interview | null {
  if (!entry || typeof entry !== "object") return null;
  const item = entry as Record<string, unknown>;
  if (item.source === "example") return null;
  const id = str(item.id, 80);
  const code = str(item.code, 16);
  const label = str(item.label, 120);
  if (!/^[a-z0-9-]+$/.test(id) || !code || !label) return null;
  const segments = parseSegments(item.segments);
  if (segments.length === 0) return null;

  const participant = str(item.participant, 120);
  const conductedAt = str(item.conductedAt, 40);
  const interviewer = str(item.interviewer, 120);
  const language = str(item.language, 8);
  const durationSec = num(item.durationSec);
  const notes = str(item.notes, MAX_NOTES);
  const addedAt = str(item.addedAt, 40);

  return {
    id,
    code,
    label,
    ...(participant ? { participant } : {}),
    ...(conductedAt && !Number.isNaN(Date.parse(conductedAt)) ? { conductedAt } : {}),
    ...(interviewer ? { interviewer } : {}),
    ...(language ? { language } : {}),
    ...(durationSec !== null ? { durationSec } : {}),
    segments,
    ...(notes ? { notes } : {}),
    source: "fieldwork",
    addedAt: addedAt && !Number.isNaN(Date.parse(addedAt)) ? addedAt : new Date(0).toISOString(),
  };
}

export function parseInterviews(raw: unknown): Interview[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseInterview).filter((x): x is Interview => x !== null);
}

/**
 * A Whisper-style JSON transcript (`{language, duration, segments:[{start,end,text}]}`)
 * → its parts. Throws with a sentence when it is not one.
 */
export function parseWhisper(raw: unknown): { language?: string; durationSec?: number; segments: Segment[] } {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("That file is not JSON.");
    }
  }
  if (!value || typeof value !== "object") throw new Error("That JSON is not a transcript.");
  const item = value as Record<string, unknown>;
  const segments = parseSegments(item.segments);
  if (segments.length === 0) throw new Error("That JSON has no transcript segments.");
  const language = str(item.language, 8);
  const durationSec = num(item.duration);
  return { ...(language ? { language } : {}), ...(durationSec !== null ? { durationSec } : {}), segments };
}

/** Plain text pasted in → one segment per non-empty line, untimed. */
export function segmentsFromText(text: string): Segment[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_SEGMENTS)
    .map((line) => ({ start: null, end: null, text: line.slice(0, MAX_SEGMENT_TEXT) }));
}

/** `P01`, `P02`… the next code not in use. */
export function nextCode(existing: readonly string[]): string {
  const used = new Set(existing);
  for (let n = 1; ; n++) {
    const code = `P${String(n).padStart(2, "0")}`;
    if (!used.has(code)) return code;
  }
}

export function wordCount(interview: Pick<Interview, "segments">): number {
  return interview.segments.reduce((sum, s) => sum + (s.text.match(/\S+/g)?.length ?? 0), 0);
}

/** `mm:ss` (or `h:mm:ss`) for a segment's start; empty for an untimed one. */
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export interface Hit {
  interviewId: string;
  index: number;
  segment: Segment;
}

/**
 * Every segment containing the query, across interviews. Plain, case-blind
 * substring search — on purpose not fuzzy: a researcher searching "dark"
 * needs to see every "dark" and nothing that merely resembles it.
 */
export function search(interviews: readonly Interview[], query: string, limit = 500): Hit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: Hit[] = [];
  for (const interview of interviews) {
    interview.segments.forEach((segment, index) => {
      if (hits.length < limit && segment.text.toLowerCase().includes(needle)) {
        hits.push({ interviewId: interview.id, index, segment });
      }
    });
  }
  return hits;
}
