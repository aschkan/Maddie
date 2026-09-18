/**
 * Police-recorded crime, from CBS — the OFFICIAL figures, added alongside the
 * reports people enter and kept carefully apart from them.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS NEVER REACHES `score.ts`, AND THAT IS THE WHOLE DESIGN.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Read that first, because it is the thing most likely to be "improved" away.
 * These figures are counts **per neighbourhood per month per offence type**.
 * A walking route usually sits inside one neighbourhood, so feeding them to the
 * route score would give every candidate route the same number — it cannot
 * answer the question this app asks, which is "which of these two ways round is
 * better". `score.ts` stays on OpenStreetMap, which changes metre by metre.
 *
 * So this is a CONTEXT layer: it says what the police recorded around here,
 * in the units the police recorded it in, and it says so on the screen. It is
 * drawn as a neighbourhood badge rather than as points, because there are no
 * points — see `basis: "area"` below, which is carried the whole way through
 * precisely so nothing downstream can forget.
 *
 * What it is NOT, and what the panel says out loud:
 *
 *   * It is not a map of where anything happened. There is no such feed.
 *   * It does not cover what this app is actually about. Harassment and
 *     catcalling are not offences anyone is charged with, so they are in no
 *     police table anywhere — which is exactly why the community layer exists
 *     and why neither replaces the other.
 *   * A neighbourhood with more recorded offences is not a more dangerous
 *     street. Reporting rates, footfall and policing all move these numbers.
 *
 * Source:
 *   Table 47022NED — "Geregistreerde misdrijven; soort misdrijf, wijk, buurt,
 *   maandcijfers", CBS StatLine, via the open OData v3 API. No key, no signup.
 *   `Soort misdrijf` is, in CBS's own words, "volgens de indeling van de
 *   politie" — the police's own classification.
 *
 * Sibling tables and why they are wrong: 47018NED is yearly (too coarse in
 * time); 47013NED and 47015NED are per municipality or per place, and one
 * figure for all of Amsterdam is the same number on the safest street and the
 * worst one.
 *
 * Everything above the "Live fetching" rule below is PURE, and pinned by
 * `test/nl-crime.test.ts` against real recorded responses in `test/fixtures/`.
 */

import { endpoint, forwarderFailure, rateLimitMessage, unreachableMessage } from "./endpoints.ts";
import type { LatLng } from "./osrm.ts";

/** The table, and the column hint. Constants — there is no env var here. */
export const CRIME_TABLE = "47022NED";
export const CRIME_TOPIC_HINT = "geregistreerdemisdrijven";

/** How many months of figures to ask for. A year, so a seasonal swing shows. */
export const MONTHS_WANTED = 12;

/**
 * Offence categories, coarser than CBS's own list because the CBS list is
 * ~30 entries and a popup cannot carry thirty rows.
 */
export type NlCrimeCategory =
  | "sexual-offence"
  | "violence-against-person"
  | "robbery"
  | "public-order"
  | "drugs"
  | "theft"
  | "burglary"
  | "criminal-damage"
  | "vehicle"
  | "other";

/**
 * Severity weights, used ONLY to colour the badge and to order the popup.
 *
 * Sexual offences dominate deliberately: this app is asked whether a woman can
 * walk here, and a neighbourhood of bicycle thefts is not the same place as a
 * neighbourhood with the same count of assaults. Colouring by raw total would
 * make the two identical, which is the whole reason this weighting exists.
 *
 * ⚠ This is NOT the route score and must never be mixed into it. It ranks
 * neighbourhoods against each other, in one legend, on one layer.
 */
export const CRIME_SEVERITY: Record<NlCrimeCategory, number> = {
  "sexual-offence": 1.0,
  "violence-against-person": 0.85,
  robbery: 0.7,
  "public-order": 0.45,
  drugs: 0.3,
  theft: 0.25,
  burglary: 0.15,
  "criminal-damage": 0.15,
  vehicle: 0.08,
  other: 0.1,
};

export const NL_CRIME_CATEGORIES = Object.keys(CRIME_SEVERITY) as NlCrimeCategory[];

/** Plain English for each, for the popup. */
export const NL_CRIME_LABEL: Record<NlCrimeCategory, string> = {
  "sexual-offence": "Sexual offences",
  "violence-against-person": "Violence against the person",
  robbery: "Robbery and street robbery",
  "public-order": "Public order",
  drugs: "Drugs and drink",
  theft: "Theft and fraud",
  burglary: "Burglary",
  "criminal-damage": "Criminal damage",
  vehicle: "Vehicle and traffic",
  other: "Other",
};

export function emptyCategoryCounts(): Record<NlCrimeCategory, number> {
  const out = {} as Record<NlCrimeCategory, number>;
  for (const category of NL_CRIME_CATEGORIES) out[category] = 0;
  return out;
}

/** Lowercase, drop the CBS numbering prefix, drop punctuation, collapse space. */
export function normaliseLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/^[\d.]+\s+/, "")
    .replace(/[.,;:/()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * TRAP: the roll-up row is labelled `Misdrijven, totaal` — WITH A COMMA. A
 * filter for the literal string "misdrijven totaal" sails straight past it, the
 * total is then summed alongside the detail rows it totals, and every figure on
 * the screen roughly doubles.
 *
 * Sub-totals ("Vermogensmisdrijven, totaal") double-count in exactly the same
 * way, so the word `totaal` anywhere in the normalised label is disqualifying.
 */
export function isRollUpLabel(label: string): boolean {
  return /\btotaal\b/.test(normaliseLabel(label));
}

/** The same row seen from its code. `0.0.0` is the all-offences roll-up. */
export function isRollUpKey(key: string): boolean {
  return key.trim().startsWith("0.0.0");
}

interface Rule {
  category: NlCrimeCategory;
  match: RegExp;
}

/**
 * Ordered: the FIRST rule that matches wins, and the order is the whole design.
 * "Diefstal/inbraak woning" is a burglary, not a theft, and "Diefstal met
 * geweld" is a robbery, not either — both would be swallowed by the plain
 * `diefstal` rule if it came first.
 */
const RULES: Rule[] = [
  { category: "sexual-offence", match: /zeden|aanrand|verkrachting|ontucht|seksue|kinderporno|prostitutie/ },
  { category: "robbery", match: /straatroof|overval|beroving|diefstal met geweld/ },
  { category: "violence-against-person", match: /mishandel|moord|doodslag|bedreig|belaging|stalking|geweldpleging|huiselijk geweld|mensenhandel|gijzeling|wederrechtelijke vrijheidsberoving/ },
  { category: "burglary", match: /inbraak|woninginbraak/ },
  { category: "vehicle", match: /motorvoertuig|voertuig|brom-|snor|fiets|verkeer|rijden onder invloed|kenteken/ },
  { category: "drugs", match: /drug|softdrug|harddrug|drank|alcohol/ },
  { category: "theft", match: /diefstal|zakkenroll|winkeldiefstal|heling|oplichting|fraude|afpersing/ },
  { category: "criminal-damage", match: /vernieling|zaakbeschadiging|brandstichting|graffiti|baldadigheid/ },
  { category: "public-order", match: /openbare orde|openlijk|overlast|discriminat|burengerucht|vuurwerk|huisvredebreuk|wapen|verstoring/ },
];

export function classifyOffence(label: string): NlCrimeCategory {
  const normalised = normaliseLabel(label);
  for (const rule of RULES) {
    if (rule.match.test(normalised)) return rule.category;
  }
  return "other";
}

/**
 * The month codes to ask for, newest last.
 *
 * TRAP: skip the most recent month. Police figures lag, and a month that is
 * only half filled in reads on the screen as a sudden drop in crime — the one
 * direction a reader will act on without checking.
 */
export function monthCodes(now: Date, count: number, skipMostRecent = 1): string[] {
  const codes: string[] = [];
  // The current calendar month is by definition incomplete, so start at the
  // previous one and then step back `skipMostRecent` further for the lag.
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  cursor.setUTCMonth(cursor.getUTCMonth() - 1 - skipMostRecent);
  for (let index = 0; index < count; index += 1) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    codes.push(`${year}MM${month}`);
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return codes.reverse();
}

/* ─────────────────────────── the table's own shape ────────────────────────── */

export interface TableShape {
  /** The region column. On 47022NED this is `WijkenEnBuurten`. */
  regionKey: string;
  /** The period column. On 47022NED this is `Perioden`. */
  periodKey: string;
  /** Measure columns, e.g. `GeregistreerdeMisdrijven_1`. */
  topicKeys: string[];
  /** Every other classifying dimension — `SoortMisdrijf` is the one wanted. */
  dimensionKeys: string[];
}

/**
 * TRAP: `GeoDetail` does not contain the substring "Dimension". A test like
 * `Type.includes("Dimension")` finds the period and the offence type and
 * silently loses the REGION — and a table whose region column cannot be found
 * reads as unusable, which ends as no crime data at all rather than as an
 * error anybody sees.
 */
const REGION_TYPES = new Set(["GeoDimension", "GeoDetail"]);
const TIME_TYPES = new Set(["TimeDimension"]);
const PLAIN_TYPES = new Set(["Dimension"]);
const TOPIC_TYPES = new Set(["Topic"]);

interface RawProperty {
  Type?: unknown;
  Key?: unknown;
}

/**
 * Read the table's columns from its own metadata rather than hard-coding them.
 *
 * Hard-coded columns are how an integration silently starts returning zero
 * rows, and zero rows is indistinguishable from zero crime — the one failure
 * this layer must never produce.
 */
export function resolveShape(reply: unknown): TableShape | null {
  const rows = odataValue(reply) as RawProperty[];
  let regionKey: string | null = null;
  let periodKey: string | null = null;
  const dimensionKeys: string[] = [];
  const topicKeys: string[] = [];

  for (const row of rows) {
    if (typeof row?.Type !== "string" || typeof row?.Key !== "string") continue;
    const type = row.Type.trim();
    if (REGION_TYPES.has(type)) regionKey ??= row.Key;
    else if (TIME_TYPES.has(type)) periodKey ??= row.Key;
    else if (PLAIN_TYPES.has(type)) dimensionKeys.push(row.Key);
    else if (TOPIC_TYPES.has(type)) topicKeys.push(row.Key);
  }

  if (regionKey === null || periodKey === null || topicKeys.length === 0) return null;
  return { regionKey, periodKey, dimensionKeys, topicKeys };
}

/**
 * TRAP: CBS appends `_1`, `_2`… to a topic key when its name collides with
 * something else in the table, so `GeregistreerdeMisdrijven` is really
 * `GeregistreerdeMisdrijven_1`. An exact lookup finds nothing, which reads as
 * a table with no figures in it.
 */
export function pickTopic(shape: TableShape, hint: string): string | null {
  const wanted = hint.toLowerCase();
  const exact = shape.topicKeys.find((key) => key.toLowerCase() === wanted);
  if (exact !== undefined) return exact;
  const prefixed = shape.topicKeys.find((key) => key.toLowerCase().startsWith(wanted));
  if (prefixed !== undefined) return prefixed;
  const contained = shape.topicKeys.find((key) => key.toLowerCase().includes(wanted));
  if (contained !== undefined) return contained;
  return shape.topicKeys[0] ?? null;
}

/** The offence dimension, by name, falling back to the first one there is. */
export function pickOffenceKey(shape: TableShape): string | null {
  const named = shape.dimensionKeys.find((key) => /misdrijf|delict/i.test(key));
  return named ?? shape.dimensionKeys[0] ?? null;
}

/* ──────────────────────────── building the query ──────────────────────────── */

export function odataQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * TRAP: month codes must be ENUMERATED, never compared with `ge`/`le`.
 * `Perioden ge '2025MM01'` is a lexicographic range, and the same column also
 * holds the ANNUAL codes `2025JJ00` — which sort inside that range. The year's
 * own total is then added to the twelve months that make it up and every
 * figure roughly triples.
 */
export function periodFilter(periodKey: string, periods: readonly string[]): string {
  if (periods.length === 0) return "";
  return `(${periods.map((period) => `${periodKey} eq ${odataQuote(period)}`).join(" or ")})`;
}

/**
 * The region clause. Several neighbourhoods in ONE request, because the map
 * shows several at once and a request apiece is a request apiece.
 *
 * TRAP: CBS pads its region codes to a fixed width and writes them with a
 * trailing space in some columns. The codes are compared with `eq` against the
 * normalised form, and `normaliseAreaCode` is the only thing that makes one.
 */
export function regionFilter(regionKey: string, codes: readonly string[]): string {
  if (codes.length === 0) return "";
  return `(${codes.map((code) => `${regionKey} eq ${odataQuote(code)}`).join(" or ")})`;
}

export function andFilters(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" and ");
}

/** Anything OData-shaped → its rows. Never throws; an unreadable reply is none. */
export function odataValue(reply: unknown): unknown[] {
  const body = reply as { value?: unknown } | null;
  return Array.isArray(body?.value) ? body.value : [];
}

/** The offence code → label map, from the table's own `SoortMisdrijf` list. */
export function parseCodeList(reply: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  for (const row of odataValue(reply)) {
    const entry = row as { Key?: unknown; Title?: unknown };
    if (typeof entry?.Key !== "string") continue;
    const title = typeof entry.Title === "string" ? entry.Title : entry.Key;
    labels.set(entry.Key.trim(), title.trim());
  }
  return labels;
}

/* ───────────────────────────── summarising rows ───────────────────────────── */

export interface CrimeSummary {
  /**
   * Point data and area data are structurally different and must not be
   * collapsed. Everything downstream branches on this, and it is a literal
   * type rather than a boolean so that a second basis cannot be bolted on
   * without every reader being made to handle it.
   */
  basis: "area";
  table: string;
  areaCode: string;
  areaName: string;
  /** THE quantity. There is no array of incidents and there never will be. */
  totalCount: number;
  byCategory: Record<NlCrimeCategory, number>;
  monthsRequested: number;
  /** Months that actually came back with a figure. The divisor. */
  monthsObserved: number;
  observedPeriods: string[];
  offencesPerMonth: number;
  /** Severity-weighted offences per month. Colours the badge, nothing else. */
  severityPerMonth: number;
  /** Cells CBS withheld. NOT zero — "not published", usually small numbers. */
  suppressedCells: number;
  rollUpRowsExcluded: number;
}

export interface SummariseInput {
  rows: readonly unknown[];
  shape: TableShape;
  offenceKey: string;
  topicKey: string;
  labels: ReadonlyMap<string, string>;
  requestedPeriods: readonly string[];
  areaCode: string;
  areaName: string;
}

export function summariseCrimeRows(input: SummariseInput): CrimeSummary {
  const byCategory = emptyCategoryCounts();
  const observed = new Set<string>();
  let totalCount = 0;
  let suppressedCells = 0;
  let rollUpRowsExcluded = 0;

  for (const raw of input.rows) {
    const row = raw as Record<string, unknown>;
    if (!row || typeof row !== "object") continue;

    const offenceCode = String(row[input.offenceKey] ?? "").trim();
    const label = input.labels.get(offenceCode) ?? offenceCode;
    if (isRollUpKey(offenceCode) || isRollUpLabel(label)) {
      rollUpRowsExcluded += 1;
      continue;
    }

    const period = String(row[input.shape.periodKey] ?? "").trim();
    const value = row[input.topicKey];

    /*
     * TRAP: `null` means NOT PUBLISHED — usually small-number suppression, to
     * stop an individual being identifiable — and it never means zero.
     * Counting it as zero reads on the screen as "nothing happened here",
     * which is the most reassuring possible rendering of missing data.
     */
    if (value === null || value === undefined) {
      suppressedCells += 1;
      continue;
    }

    const count = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(count)) {
      suppressedCells += 1;
      continue;
    }

    if (period !== "") observed.add(period);
    totalCount += count;
    byCategory[classifyOffence(label)] += count;
  }

  const monthsObserved = observed.size;
  /*
   * TRAP: divide by the months that RETURNED data, not the months requested.
   * Dividing by an unfilled window understates the rate by exactly the lag,
   * and the lag is the thing this table is most reliably wrong about.
   */
  const divisor = monthsObserved > 0 ? monthsObserved : 1;
  let weighted = 0;
  for (const category of NL_CRIME_CATEGORIES) {
    weighted += byCategory[category] * CRIME_SEVERITY[category];
  }

  return {
    basis: "area",
    table: CRIME_TABLE,
    areaCode: input.areaCode,
    areaName: input.areaName,
    totalCount,
    byCategory,
    monthsRequested: input.requestedPeriods.length,
    monthsObserved,
    observedPeriods: [...observed].sort(),
    offencesPerMonth: totalCount / divisor,
    severityPerMonth: weighted / divisor,
    suppressedCells,
    rollUpRowsExcluded,
  };
}

/**
 * A summary with somewhere to draw it.
 *
 * The point comes from PDOK, never from CBS — the crime table has no geometry
 * at all, which is the whole reason `nl-areas.ts` exists. It is the
 * neighbourhood's CENTROID and it is where the LABEL goes: nothing happened
 * there, and nothing downstream may treat it as a location. A separate type
 * from `CrimeSummary` so that the figures can be summarised, tested and
 * reasoned about without a coordinate anywhere near them.
 */
export interface PlacedCrimeSummary extends CrimeSummary {
  point: LatLng;
}

/** The categories with something in them, heaviest first, for the popup. */
export function topCategories(
  summary: CrimeSummary,
  limit = 4,
): { category: NlCrimeCategory; label: string; count: number }[] {
  return NL_CRIME_CATEGORIES
    .map((category) => ({ category, label: NL_CRIME_LABEL[category], count: summary.byCategory[category] }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) =>
      b.count * CRIME_SEVERITY[b.category] - a.count * CRIME_SEVERITY[a.category] || b.count - a.count)
    .slice(0, limit);
}

/**
 * Which of four bands a neighbourhood's weighted rate falls in.
 *
 * Bands rather than a continuous scale, and four rather than ten, because the
 * precision is not there: these are counts with a reporting lag, suppressed
 * cells and a denominator that varies with how many people walk through. A
 * smooth gradient would invite reading a difference between two neighbourhoods
 * that the figures cannot support — the same refusal `compare.ts` makes about
 * two routes six points apart.
 *
 * The thresholds are in severity-weighted offences per month and are chosen to
 * split a city into roughly four groups, not to mark a line between safe and
 * unsafe. There is no such line in this data and the panel says so.
 */
export type CrimeBand = "low" | "medium" | "high" | "highest";

export const CRIME_BAND_LABEL: Record<CrimeBand, string> = {
  low: "Fewer recorded offences",
  medium: "Around the middle",
  high: "More recorded offences",
  highest: "Most recorded offences",
};

export function crimeBand(severityPerMonth: number): CrimeBand {
  if (!Number.isFinite(severityPerMonth) || severityPerMonth < 5) return "low";
  if (severityPerMonth < 15) return "medium";
  if (severityPerMonth < 40) return "high";
  return "highest";
}

/* ────────────────────────────── live fetching ─────────────────────────────── */

export const CBS_BASE = endpoint("cbs");

/** One reply's worth of rows. A year of one neighbourhood is ~120 of them. */
const ROW_CAP = 4_000;

interface Json {
  ok: boolean;
  status: number;
  body: unknown;
}

async function askCbs(path: string, search: string, signal?: AbortSignal): Promise<Json> {
  const response = await fetch(`${CBS_BASE}/${path}${search}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) return { ok: false, status: response.status, body: null };
  try {
    return { ok: true, status: response.status, body: await response.json() };
  } catch {
    return { ok: false, status: response.status, body: null };
  }
}

export interface CrimeFetch {
  summaries: CrimeSummary[];
  /** The months actually asked for, so the panel can say what window this is. */
  periods: string[];
}

/**
 * Figures for a set of neighbourhoods, in one round of requests.
 *
 * Three calls, never more: the table's shape, the offence labels, and the rows.
 * The first two describe the table rather than the data and are stable for as
 * long as the table is, so the forwarder's cache holds them for a day.
 *
 * A failure returns a SENTENCE, never an empty list. An empty crime layer is
 * the one thing on this page that reads as reassurance, and a silent zero here
 * would be a statement about a neighbourhood that nobody made.
 */
export async function fetchNeighbourhoodCrime(
  areas: readonly { code: string; name: string }[],
  options: { now?: Date; months?: number; signal?: AbortSignal } = {},
): Promise<{ ok: true; data: CrimeFetch } | { ok: false; error: string }> {
  if (areas.length === 0) return { ok: true, data: { summaries: [], periods: [] } };

  const periods = monthCodes(options.now ?? new Date(), options.months ?? MONTHS_WANTED);

  try {
    const properties = await askCbs(`${CRIME_TABLE}/DataProperties`, "", options.signal);
    if (!properties.ok) return { ok: false, error: cbsFailure(properties.status) };

    const shape = resolveShape(properties.body);
    if (!shape) {
      return {
        ok: false,
        error: `CBS table ${CRIME_TABLE} did not describe the columns this needs. The figures are not loaded.`,
      };
    }

    const topicKey = pickTopic(shape, CRIME_TOPIC_HINT);
    const offenceKey = pickOffenceKey(shape);
    if (!topicKey || !offenceKey) {
      return {
        ok: false,
        error: `CBS table ${CRIME_TABLE} has no offence or count column this build understands.`,
      };
    }

    const labelReply = await askCbs(`${CRIME_TABLE}/${offenceKey}`, "", options.signal);
    const labels = labelReply.ok ? parseCodeList(labelReply.body) : new Map<string, string>();

    const codes = areas.map((area) => area.code);
    const filter = andFilters([
      regionFilter(shape.regionKey, codes),
      periodFilter(shape.periodKey, periods),
    ]);
    const search = `?$filter=${encodeURIComponent(filter)}&$top=${ROW_CAP}`;
    const data = await askCbs(`${CRIME_TABLE}/TypedDataSet`, search, options.signal);
    if (!data.ok) return { ok: false, error: cbsFailure(data.status) };

    const rows = odataValue(data.body);
    const summaries: CrimeSummary[] = [];
    for (const area of areas) {
      const mine = rows.filter((raw) => {
        const row = raw as Record<string, unknown>;
        return String(row?.[shape.regionKey] ?? "").trim() === area.code;
      });
      // A neighbourhood the table holds nothing for is left OUT rather than
      // drawn as a zero. "Not in the table" and "no offences" are different.
      if (mine.length === 0) continue;
      summaries.push(summariseCrimeRows({
        rows: mine,
        shape,
        offenceKey,
        topicKey,
        labels,
        requestedPeriods: periods,
        areaCode: area.code,
        areaName: area.name,
      }));
    }

    return { ok: true, data: { summaries, periods } };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "cancelled" };
    }
    return { ok: false, error: `${unreachableMessage("cbs", "CBS")} The police figures are not loaded.` };
  }
}

/** Which end failed, in the same shape the map layers already use. */
function cbsFailure(status: number): string {
  const ours = forwarderFailure("cbs", status);
  if (ours) return ours;
  if (status === 429) return "CBS is rate limiting us. Wait a minute and try again.";
  return `CBS answered ${status}. The police figures are not loaded.`;
}

/** Exported for the layer, which wants the same sentence for a 429 reply. */
export async function cbsRateLimited(response: Response): Promise<string> {
  return `${await rateLimitMessage(response, "the police figures")} The figures are not loaded.`;
}
