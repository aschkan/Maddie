/**
 * The Pointer "Onveilige plekken" export → reports. Pure, tested, no I/O.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ SOURCE, AND IT MUST BE CITED WHEREVER THE DATA IS SHOWN:                 │
 * │ Onveilige Plekken kaart 2026, Pointer (KRO-NCRV) i.s.m. het AD en de     │
 * │ regionale titels. Not for commercial use. `POINTER_CREDIT` is that line. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Pointer ran a survey from March 2024 asking where people in the Netherlands
 * feel unsafe, and why. Every row is ONE place somebody pinned on a map, with
 * the survey's answers about it. Two survey versions (v1 from 21-03-2024, v2
 * from 24-11-2025) feed the same columns; the options differ slightly in
 * wording, which the tables below absorb.
 *
 * What a row is NOT, and the boards have to keep saying so:
 *
 *   * **Not an incident.** "Why do you feel unsafe here" has three answers, and
 *     the commonest by far (≈13k of 18k) is "the area feels threatening" —
 *     nothing happened. So a reason is carried as a REASON, never re-labelled
 *     as a crime type, and the dashboard's "type" is that reason.
 *   * **Not timed.** `datum_melding` is when the survey was FILLED IN, not when
 *     anything happened, and there is no hour at all. For v2 rows it is often
 *     not even a day but the map's whole window (`24-11-2025 - 10-06-2026`):
 *     that is kept as a RANGE (`at` … `atUntil`), never collapsed to a fake day. `tijdstip` is when the
 *     place feels unsafe (day / after dark / any time), and that is what the
 *     boards chart instead of an hour of day.
 *   * **Respondent-located.** Pointer removed the obvious "searched for the
 *     city name" pins (city centroids, Putten) but says some may remain.
 *
 * The CSV is `;`-separated with RFC-4180 quoting, a BOM, and multi-valued
 * cells joined with ` | `. The stored record is in English ids so the code can
 * branch on it; the Dutch wording is kept in the tables for the popup.
 *
 * The file itself is NEVER committed (this repository is public and Pointer
 * hands the data out on request, for non-commercial use). It is read ONCE, by
 * `scripts/import-pointer.ts` or the admin panel's import, into MongoDB — the
 * database is where this data lives from then on.
 */

import type { Report, ReportType, When } from "./reports.ts";

export const POINTER_CREDIT =
  "Onveilige Plekken kaart 2026, Pointer (KRO-NCRV) i.s.m. het AD en de regionale titels";

/** The survey's three reasons, most direct first — that order picks the primary. */
export const REASONS: { id: Exclude<ReportType, "other">; nl: string; label: string }[] = [
  { id: "experienced", nl: "Er is mij hier iets overkomen.", label: "Something happened to me here" },
  { id: "witnessed", nl: "Ik weet dat iemand anders hier iets is overkomen.", label: "Something happened to someone I know of" },
  { id: "environment", nl: "Ik vind de omgeving eng, mij kan hier makkelijk iets overkomen.", label: "The surroundings feel threatening" },
];

export const WHEN_NL: Record<string, When> = {
  "vooral als het donker is": "dark",
  "vooral overdag": "day",
  "tijdstip maakt niet uit": "any",
};

/**
 * "Do you change your behaviour?" — v1 and v2 spell several options
 * differently ("vrienden/familie" vs "vrienden of familie"), so matching is on
 * a normalised prefix rather than the exact string.
 */
export const ADJUSTMENTS: { id: string; match: string; label: string }[] = [
  { id: "none", match: "nee", label: "No, nothing changes" },
  { id: "stay-away", match: "ik kom er niet meer", label: "I no longer go there" },
  { id: "picked-up", match: "ik vraag iemand om mij op te halen", label: "I ask someone to pick me up" },
  { id: "other-transport", match: "ik neem ander vervoer", label: "I take other transport" },
  { id: "clothes", match: "ik draag andere kleren", label: "I wear different clothes" },
  { id: "not-after-dark", match: "ik ga daar niet heen in het donker", label: "I don't go there after dark" },
  { id: "weapon", match: "ik bescherm mezelf met een wapen", label: "I carry something to protect myself" },
  { id: "less-alcohol", match: "ik drink geen of minder alcohol", label: "I drink less or no alcohol" },
  { id: "watch-drink", match: "ik pas goed op dat niemand iets in mijn drankje", label: "I watch my drink" },
  { id: "group", match: "ik ga altijd met een groepje", label: "I always go with a group" },
  { id: "share-location", match: "ik deel mijn live-locatie", label: "I share my live location" },
  { id: "tell-someone", match: "ik laat vrienden", label: "I tell friends or family where I am" },
  { id: "detour", match: "ik rijd", label: "I take a detour" },
  { id: "fake-call", match: "ik doe alsof ik iemand bel", label: "I pretend to be on a call" },
  { id: "leave-early", match: "ik ga eerder naar huis", label: "I go home earlier than I want to" },
  { id: "other", match: "anders", label: "Something else" },
];

export const ADJUSTMENT_LABEL = new Map(ADJUSTMENTS.map((a) => [a.id, a.label]));

/** The survey's age bands, in order. Both versions' spellings map onto these. */
export const AGE_BANDS = ["<12", "12-17", "18-25", "26-35", "36-45", "46-55", "56-65", "66-75", "76+"];

export function ageBand(raw: string): string | undefined {
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;
  if (text.startsWith("jonger")) return "<12";
  if (text.startsWith("75plus") || text.startsWith("76")) return "76+";
  const range = text.match(/^(\d{2})-(\d{2})/);
  if (range && AGE_BANDS.includes(`${range[1]}-${range[2]}`)) return `${range[1]}-${range[2]}`;
  return undefined;
}

const norm = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

export function reasonIds(cell: string): Exclude<ReportType, "other">[] {
  const parts = splitMulti(cell).map(norm);
  return REASONS.filter((reason) => parts.includes(norm(reason.nl))).map((reason) => reason.id);
}

export function adjustmentIds(cell: string): string[] {
  const out: string[] = [];
  for (const part of splitMulti(cell).map(norm)) {
    const hit = ADJUSTMENTS.find((a) => (a.id === "none" ? part === a.match : part.startsWith(a.match)));
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

function splitMulti(cell: string): string[] {
  return cell.split(" | ").map((part) => part.trim()).filter(Boolean);
}

/** `dd/mm/yyyy` or `dd-mm-yyyy` → an ISO instant at noon UTC, or null. Noon so no timezone moves the day. */
export function surveyDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), 12));
  if (date.getUTCDate() !== Number(d)) return null;
  return date.toISOString();
}

/** A day, or a `from - to` window of days. Null when it is neither. */
export function surveyWhen(raw: string): { at: string; until?: string } | null {
  const single = surveyDate(raw);
  if (single) return { at: single };
  const parts = raw.split(/\s+-\s+/);
  if (parts.length !== 2) return null;
  const from = surveyDate(parts[0]!);
  const to = surveyDate(parts[1]!);
  if (!from || !to || to < from) return null;
  return from === to ? { at: from } : { at: from, until: to };
}

/**
 * `;`-separated CSV → rows of cells. Quotes, doubled quotes, and newlines
 * inside a quoted cell are honoured — the free-text `verhaal` column holds all
 * three.
 */
export function parseCsv(text: string, delimiter = ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

export const POINTER_COLUMNS = [
  "locatie_id", "longitude", "latitude", "plaats", "tijdstip", "reden_onveilig",
  "gedrag_aanpassing", "leeftijd", "datum_melding", "verhaal", "upvotes", "versie",
] as const;

export interface PointerImport {
  reports: Report[];
  /** Rows that could not become a report, with why — printed, never silently dropped. */
  skipped: { line: number; why: string }[];
}

/** The longest story kept. Pointer's longest is ~2.3k characters. */
export const MAX_STORY = 4_000;

/** A whole export → reports with `source: "pointer"`. Throws if it is not a Pointer export. */
export function parsePointerCsv(text: string): PointerImport {
  const rows = parseCsv(text);
  const header = (rows.shift() ?? []).map((name) => name.trim().toLowerCase());
  const missing = POINTER_COLUMNS.filter((name) => !header.includes(name));
  if (missing.length > 0) {
    throw new Error(`Not a Pointer export: missing column(s) ${missing.join(", ")}.`);
  }
  const col = (row: string[], name: (typeof POINTER_COLUMNS)[number]) => (row[header.indexOf(name)] ?? "").trim();

  const reports: Report[] = [];
  const skipped: PointerImport["skipped"] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const id = col(row, "locatie_id");
    const lat = Number(col(row, "latitude").replace(",", "."));
    const lng = Number(col(row, "longitude").replace(",", "."));
    const date = surveyWhen(col(row, "datum_melding"));
    if (!id) return skipped.push({ line, why: "no locatie_id" });
    // Number("") is 0, and 0,0 is the Gulf of Guinea — an empty cell is not a coordinate.
    if (!col(row, "latitude") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return skipped.push({ line, why: "no usable coordinate" });
    }
    if (!date) return skipped.push({ line, why: `no usable date "${col(row, "datum_melding")}"` });

    const reasons = reasonIds(col(row, "reden_onveilig"));
    const when = WHEN_NL[norm(col(row, "tijdstip"))];
    const adjustments = adjustmentIds(col(row, "gedrag_aanpassing"));
    const age = ageBand(col(row, "leeftijd"));
    const place = col(row, "plaats");
    const note = col(row, "verhaal").slice(0, MAX_STORY);
    const upvotes = Number.parseInt(col(row, "upvotes"), 10);
    const form = col(row, "versie").toLowerCase();

    reports.push({
      id: `pointer-${id}`,
      category: reasons[0] ?? "other",
      point: { lat, lng },
      at: date.at,
      ...(date.until ? { atUntil: date.until } : {}),
      source: "pointer",
      ...(reasons.length ? { reasons } : {}),
      ...(when ? { when } : {}),
      ...(adjustments.length ? { adjustments } : {}),
      ...(age ? { age } : {}),
      ...(place ? { place } : {}),
      ...(note ? { note } : {}),
      ...(Number.isFinite(upvotes) && upvotes > 0 ? { upvotes } : {}),
      ...(form === "v1" || form === "v2" ? { form } : {}),
    });
  });
  return { reports, skipped };
}
