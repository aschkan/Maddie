/**
 * How SERIOUS a report reads — the shading of the dots, and nothing else.
 *
 * From the supervisor meeting of 4 November 2026: "not all reports are the
 * same … I feel weird here versus I was harassed here." The map used to draw
 * every report in one full-strength colour, so a vague unease and a harassment
 * report looked identical and the dots drowned the parks and the bridges. Now:
 *
 *   * each report gets a RANK from an ordered list of kinds — the designer's
 *     default first, shown on screen, and the reader can drag to reorder it;
 *   * the rank becomes colour intensity + opacity + size (`palette.ts`
 *     `REPORT_RAMP`): darkest/most opaque = what the reader says matters most,
 *     the lightest is little more than an outline;
 *   * a record can carry several reasons ("one crate can be more than one data
 *     point"), so it takes the MOST serious of them — never an average;
 *   * a very basic keyword read of the story text flags harassment and
 *     catcalling, so such a report can surface without anybody tagging it.
 *     "The point is not whether this is accurate. The point is how you show
 *     it." It is a hint about how to shade a dot, not a classifier, and it is
 *     labelled as such wherever it is shown.
 *
 * It never enters any score or count. Shading changes what stands out on the
 * map; it does not change what is counted.
 */

import type { Report, ReportType } from "./reports.ts";

/** What can be ranked: the survey's reasons, and the story-text flag. */
export type ImportanceKey = ReportType | "harassment";

export const IMPORTANCE_ITEMS: { id: ImportanceKey; label: string; hint: string }[] = [
  {
    id: "harassment",
    label: "Story mentions harassment or catcalling",
    hint: "A basic keyword check of the respondent's own words (Dutch and English). Not a classifier — a hint.",
  },
  { id: "experienced", label: "Happened to me", hint: "Something happened to the respondent here." },
  { id: "witnessed", label: "Happened to others", hint: "Something happened to someone the respondent knows of." },
  { id: "environment", label: "Feels threatening", hint: "The surroundings feel threatening; nothing is said to have happened." },
  { id: "other", label: "Other / not given", hint: "No reason given." },
];

/** The designer's default: the most direct experience first. Shown, and changeable. */
export const DEFAULT_ORDER: ImportanceKey[] = IMPORTANCE_ITEMS.map((item) => item.id);

/** How many shades there are — one per rank. */
export const LEVELS = DEFAULT_ORDER.length;

/**
 * Words that say harassment or catcalling happened, in the languages the
 * stories are written in. Stems, matched case-insensitively at a word start,
 * so "nageroepen", "nagefloten" and "lastiggevallen" all hit.
 */
const WORDS = [
  // Dutch
  "nageroepen", "naroepen", "nagefloten", "nafluiten", "gefloten", "sissen",
  "lastiggevallen", "lastig gevallen", "lastigvallen", "intimid", "betast", "aangerand", "aanranding",
  "achtervolg", "gevolgd", "seksue", "potloodvent", "begluurd", "opgewacht",
  "straatintimidatie", "uitgescholden",
  // English
  "harass", "catcall", "cat-call", "cat call", "whistl", "groped", "grope", "followed me", "stalk", "flashed",
  "assault", "sexual", "leered", "shouted at",
];

const PATTERN = new RegExp(`(^|[^\\p{L}])(${WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "iu");
// "straatintimidatie" contains "intimid" mid-word, so it is listed on its own.

/** Does the story text say harassment or catcalling happened? Basic and labelled as such. */
export function mentionsHarassment(note: string | undefined | null): boolean {
  return !!note && PATTERN.test(note);
}

/** Every rankable kind a report carries — all its reasons, plus the story flag. */
export function keysOf(report: Pick<Report, "category" | "reasons" | "note">): ImportanceKey[] {
  const keys: ImportanceKey[] = [...(report.reasons?.length ? report.reasons : [report.category])];
  if (mentionsHarassment(report.note)) keys.push("harassment");
  return keys;
}

/**
 * 0 = the most serious shade. A record takes the MOST serious of its kinds —
 * a place marked both "happened to me" and "feels threatening" is the former.
 */
export function rankOf(report: Pick<Report, "category" | "reasons" | "note">, order: readonly ImportanceKey[] = DEFAULT_ORDER): number {
  let best = LEVELS - 1;
  for (const key of keysOf(report)) {
    const at = order.indexOf(key);
    if (at >= 0 && at < best) best = at;
  }
  return best;
}

/** An order read back from storage: every key once, unknown ones dropped, missing ones appended. */
export function normaliseOrder(raw: unknown): ImportanceKey[] {
  const out: ImportanceKey[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (DEFAULT_ORDER.includes(item as ImportanceKey) && !out.includes(item as ImportanceKey)) out.push(item as ImportanceKey);
    }
  }
  for (const key of DEFAULT_ORDER) if (!out.includes(key)) out.push(key);
  return out;
}

/** Move one key to another position — what a drop, or an up/down button, does. */
export function moveKey(order: readonly ImportanceKey[], key: ImportanceKey, to: number): ImportanceKey[] {
  const rest = order.filter((k) => k !== key);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}
