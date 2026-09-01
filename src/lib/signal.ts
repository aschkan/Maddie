/**
 * The one rule that matters most, as a type.
 *
 * Three states, never two:
 *   measured and fine   → { available: true,  ... }
 *   measured and not    → { available: true,  ... }
 *   NOT MEASURED        → { available: false, reason, note }
 *
 * A gap in what we could see is never reported as a statement about the place.
 * If the crime API is unreachable and the app says "no offences recorded
 * nearby", a woman reads reassurance where the truth is "we did not look".
 */

export type MissingReason =
  | "not-configured" // no key / the source is switched off
  | "unreachable" // we asked and got nothing back
  | "no-coverage" // the source exists but does not cover this place
  | "out-of-region" // this deployment's data does not reach here
  | "not-published"; // the source withholds the figure (e.g. small numbers)

export interface Present<T> {
  available: true;
  value: T;
  source: string;
  /** 0..1. A signal that had to be guessed at lowers this rather than lying. */
  confidence: number;
  note?: string;
}

export interface Absent {
  available: false;
  reason: MissingReason;
  source: string;
  /** Always a full sentence, written for the person reading the screen. */
  note: string;
}

export type Signal<T> = Present<T> | Absent;

export function present<T>(value: T, source: string, confidence: number, note?: string): Present<T> {
  return { available: true, value, source, confidence: clamp01(confidence), ...(note ? { note } : {}) };
}

export function absent(reason: MissingReason, source: string, note: string): Absent {
  return { available: false, reason, source, note };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Standard wording, so the same gap never reads two different ways. */
export function gapNote(what: string, reason: MissingReason): string {
  switch (reason) {
    case "not-configured":
      return `${what} is not configured on this deployment, so this signal was not measured. That is a gap in the data, not a statement about the place.`;
    case "unreachable":
      return `${what} could not be reached, so this signal was not measured. That is a gap in the data, not a statement about the place.`;
    case "no-coverage":
      return `${what} has no coverage here, so this signal was not measured. That is a gap in the data, not a statement about the place.`;
    case "out-of-region":
      return `${what} only covers this deployment's region, so this signal was not measured here. That is a gap in the data, not a statement about the place.`;
    case "not-published":
      return `${what} withholds figures for this area, usually because the counts are too small to publish. That is a gap in the data, not a statement about the place.`;
  }
}
