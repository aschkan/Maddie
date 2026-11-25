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
 *   * every report falls into exactly ONE class (`classOf`): harassment
 *     mentioned or not, crossed with whether it happened to the respondent or
 *     to others, plus "nothing happened, it feels threatening";
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

/**
 * The CLASSES a report falls into — exactly one each. From the meeting of
 * 25 Nov 2026: "if a story is harassment and it happened to me, where does it
 * go, up or down?" The earlier list mixed two questions (what the story says,
 * and who it happened to), so one report could match several rows and the
 * reader could not tell which shade it would get. Now the two questions are
 * crossed:
 *
 *   is harassment or catcalling mentioned?  ×  did it happen to me or others?
 *
 * plus one class for a place where nothing is said to have happened. Every
 * report lands in exactly one row of the legend.
 */
export type ImportanceKey = "harassment-me" | "harassment-others" | "me" | "others" | "feeling";

export const IMPORTANCE_ITEMS: { id: ImportanceKey; label: string; hint: string }[] = [
  {
    id: "harassment-me",
    label: "Harassment or catcalling, happened to the respondent",
    hint: "The story mentions harassment or catcalling (a basic keyword check, Dutch and English) and the respondent says it happened to them.",
  },
  {
    id: "harassment-others",
    label: "Harassment or catcalling, happened to others",
    hint: "The story mentions harassment or catcalling, and it happened to someone else (or the respondent does not say to whom).",
  },
  { id: "me", label: "Other story, happened to the respondent", hint: "Something happened to the respondent here; the story does not mention harassment or catcalling." },
  { id: "others", label: "Other story, happened to others", hint: "Something happened to someone the respondent knows of; no mention of harassment or catcalling." },
  { id: "feeling", label: "Nothing happened — the place feels threatening, or no reason given", hint: "The surroundings feel threatening, or no reason was given. Nothing is said to have happened." },
];

/** The designer's default: the clearest, most direct experience first. Shown, and changeable. */
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

/**
 * The ONE class a report belongs to. "Happened to me" beats "to others" when a
 * record gives both — the more direct account.
 */
export function classOf(report: Pick<Report, "category" | "reasons" | "note">): ImportanceKey {
  const reasons: ReportType[] = report.reasons?.length ? report.reasons : [report.category];
  const me = reasons.includes("experienced");
  const others = reasons.includes("witnessed");
  if (mentionsHarassment(report.note)) return me ? "harassment-me" : "harassment-others";
  if (me) return "me";
  if (others) return "others";
  return "feeling";
}

/** 0 = the darkest shade: where the report's class sits in the reader's order. */
export function rankOf(report: Pick<Report, "category" | "reasons" | "note">, order: readonly ImportanceKey[] = DEFAULT_ORDER): number {
  const at = order.indexOf(classOf(report));
  return at >= 0 ? at : LEVELS - 1;
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
