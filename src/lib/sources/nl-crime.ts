/**
 * Recorded crime for a Dutch neighbourhood, from CBS StatLine table 47022NED
 * ("Geregistreerde misdrijven; soort misdrijf, wijk, buurt, maandcijfers").
 *
 * The shape of this data decides the shape of the score. It is NOT a list of
 * offences with points: it is counts per neighbourhood per month per offence
 * type. There is nothing to plot and nothing to measure a distance to, so the
 * whole pipeline carries `basis: "area"` and never pretends otherwise.
 */
import { cached } from "../cache.ts";
import { getConfig } from "../config.ts";
import { UpstreamStatusError, UpstreamTimeoutError, UpstreamTransportError } from "../http/fetch.ts";
import { absent, gapNote, present, type Signal } from "../signal.ts";
import type { AreaCode, AreaLevel } from "./pdok.ts";
import {
  andFilters,
  fetchCodeList,
  fetchDataProperties,
  fetchTypedDataSet,
  odataQuote,
  periodFilter,
  pickTopic,
  resolveShape,
  type CodeLabel,
  type StatLineClient,
  type TableShape,
} from "./statline.ts";

export type CrimeCategory =
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
 * Severity weights. Sexual offences dominate deliberately: this app is asked
 * whether a woman can walk here, and a neighbourhood of bicycle thefts is not
 * the same place as a neighbourhood with the same count of assaults.
 */
export const CRIME_SEVERITY: Record<CrimeCategory, number> = {
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

export const CRIME_CATEGORIES = Object.keys(CRIME_SEVERITY) as CrimeCategory[];

export function emptyCategoryCounts(): Record<CrimeCategory, number> {
  const out = {} as Record<CrimeCategory, number>;
  for (const category of CRIME_CATEGORIES) out[category] = 0;
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
 * TRAP: the roll-up row is labelled `Misdrijven, totaal` — with a comma. A
 * filter for the literal string "misdrijven totaal" sails straight past it,
 * the total is then summed alongside the detail rows it totals, and every
 * figure in the table roughly doubles.
 *
 * Sub-totals ("Vermogensmisdrijven, totaal") double-count in exactly the same
 * way, so the word `totaal` anywhere in the normalised label is disqualifying.
 */
export function isRollUpLabel(label: string): boolean {
  const normalised = normaliseLabel(label);
  return /\btotaal\b/.test(normalised);
}

export function isRollUpKey(key: string): boolean {
  return key.trim().startsWith("0.0.0");
}

interface Rule {
  category: CrimeCategory;
  match: RegExp;
}

/**
 * Ordered: the first rule that matches wins. Order is the whole design —
 * "Diefstal/inbraak woning" is a burglary, not a theft, and "Diefstal met
 * geweld" is a robbery, not either.
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

export function classifyOffence(label: string): CrimeCategory {
  const normalised = normaliseLabel(label);
  for (const rule of RULES) {
    if (rule.match.test(normalised)) return rule.category;
  }
  return "other";
}

/**
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

export interface CrimeSummary {
  /**
   * Point data and area data are structurally different and must not be
   * collapsed. Everything downstream branches on this.
   */
  basis: "area";
  table: string;
  areaCode: string;
  areaLevel: AreaLevel;
  areaName: string;
  /** THE quantity. `incidents.length` is empty on the area basis. */
  totalCount: number;
  byCategory: Record<CrimeCategory, number>;
  monthsRequested: number;
  /** Months that actually came back with a figure. The divisor. */
  monthsObserved: number;
  observedPeriods: string[];
  offencesPerMonth: number;
  /** Severity-weighted offences per month. */
  severityPerMonth: number;
  /** Cells CBS withheld. Not zero — "not published", usually small numbers. */
  suppressedCells: number;
  rollUpRowsExcluded: number;
}

export interface SummariseInput {
  rows: ReadonlyArray<Record<string, unknown>>;
  shape: TableShape;
  offenceKey: string;
  topicKey: string;
  labels: ReadonlyMap<string, string>;
  requestedPeriods: readonly string[];
  table: string;
  area: AreaCode;
}

export function summariseCrimeRows(input: SummariseInput): CrimeSummary {
  const byCategory = emptyCategoryCounts();
  const observed = new Set<string>();
  let totalCount = 0;
  let suppressedCells = 0;
  let rollUpRowsExcluded = 0;

  for (const row of input.rows) {
    const offenceCode = String(row[input.offenceKey] ?? "").trim();
    const label = input.labels.get(offenceCode) ?? offenceCode;
    if (isRollUpKey(offenceCode) || isRollUpLabel(label)) {
      rollUpRowsExcluded += 1;
      continue;
    }

    const period = String(row[input.shape.periodKey] ?? "").trim();
    const raw = row[input.topicKey];

    // TRAP: `null` means NOT PUBLISHED — usually small-number suppression —
    // and never zero. Counting it as zero reads as "nothing happened here".
    if (raw === null || raw === undefined) {
      suppressedCells += 1;
      continue;
    }

    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      suppressedCells += 1;
      continue;
    }

    if (period !== "") observed.add(period);
    totalCount += value;
    byCategory[classifyOffence(label)] += value;
  }

  const monthsObserved = observed.size;
  // TRAP: divide by the months that returned data, not the months requested.
  // Dividing by an unfilled window understates the rate by exactly the lag.
  const divisor = monthsObserved > 0 ? monthsObserved : 1;
  let weighted = 0;
  for (const category of CRIME_CATEGORIES) weighted += byCategory[category] * CRIME_SEVERITY[category];

  return {
    basis: "area",
    table: input.table,
    areaCode: input.area.code,
    areaLevel: input.area.level,
    areaName: input.area.name,
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

// ── Live fetching ───────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;

export interface ResolvedTable {
  client: StatLineClient;
  shape: TableShape;
  offenceKey: string;
  topicKey: string;
}

export async function resolveTable(table: string, topicHint: string): Promise<ResolvedTable | null> {
  const config = getConfig();
  const client: StatLineClient = { base: config.crimeODataUrl, table };
  return cached(`statline:shape:${config.crimeODataUrl}:${table}:${topicHint}`, DAY, async () => {
    const properties = await fetchDataProperties(client);
    const shape = resolveShape(properties);
    if (shape === null) return null;
    const topicKey = pickTopic(shape, topicHint);
    if (topicKey === null) return null;
    // The offence dimension is the classifying dimension that is neither the
    // region nor the period. Reading it off the metadata means a renamed
    // column changes nothing here.
    const offenceKey = shape.dimensionKeys[0] ?? "";
    return { client, shape, offenceKey, topicKey };
  });
}

async function offenceLabels(resolved: ResolvedTable): Promise<Map<string, string>> {
  if (resolved.offenceKey === "") return new Map();
  const list = await cached<CodeLabel[]>(
    `statline:labels:${resolved.client.table}:${resolved.offenceKey}`,
    DAY,
    () => fetchCodeList(resolved.client, resolved.offenceKey),
  );
  return new Map(list.map((row) => [row.key.trim(), row.title]));
}

/**
 * CBS pads region keys to a fixed width with trailing spaces, so the exact
 * string in the data is not the code PDOK gave us. Look up the real one.
 */
async function resolveRegionKey(resolved: ResolvedTable, code: string): Promise<string | null> {
  const list = await cached<CodeLabel[]>(
    `statline:region:${resolved.client.table}:${code}`,
    DAY,
    () => fetchCodeList(resolved.client, resolved.shape.regionKey, code),
  );
  const exact = list.find((row) => row.key.trim() === code);
  return exact?.key ?? list[0]?.key ?? null;
}

export interface CrimeQuery {
  area: AreaCode;
  now?: Date;
  windowMonths?: number;
  table?: string;
  topicHint?: string;
  label?: string;
}

/** Recorded crime for one area, or an honest account of why there is none. */
export async function fetchAreaCrime(query: CrimeQuery): Promise<Signal<CrimeSummary>> {
  const config = getConfig();
  const table = query.table ?? config.crimeTable;
  const sourceName = `CBS StatLine ${table}`;

  if (!config.crimeEnabled) {
    return absent("not-configured", sourceName, gapNote("Recorded-crime data", "not-configured"));
  }
  if (config.region !== "NL") {
    return absent(
      "out-of-region",
      sourceName,
      "This deployment carries Dutch police figures only. No recorded-crime data was consulted for this place. That is a gap in the data, not a statement about the place.",
    );
  }

  const windowMonths = query.windowMonths ?? config.crimeWindowMonths;
  const periods = monthCodes(query.now ?? new Date(), windowMonths);

  try {
    const resolved = await resolveTable(table, query.topicHint ?? "geregistreerdemisdrijven");
    if (resolved === null) {
      return absent(
        "unreachable",
        sourceName,
        `The shape of table ${table} could not be read, so no figures were requested. That is a gap in the data, not a statement about the place.`,
      );
    }

    const regionKey = await resolveRegionKey(resolved, query.area.code);
    if (regionKey === null) {
      return absent(
        "no-coverage",
        sourceName,
        `Table ${table} has no rows for ${query.area.name} (${query.area.code}). That is a gap in the data, not a statement about the place.`,
      );
    }

    const filter = andFilters([
      `${resolved.shape.regionKey} eq ${odataQuote(regionKey)}`,
      periodFilter(resolved.shape.periodKey, periods),
    ]);
    const rows = await fetchTypedDataSet(resolved.client, filter);
    const labels = await offenceLabels(resolved);

    const summary = summariseCrimeRows({
      rows,
      shape: resolved.shape,
      offenceKey: resolved.offenceKey,
      topicKey: resolved.topicKey,
      labels,
      requestedPeriods: periods,
      table,
      area: query.area,
    });

    if (summary.monthsObserved === 0) {
      return absent(
        "not-published",
        sourceName,
        `No police figures were returned for ${query.area.name} over the last ${windowMonths} months. That is a gap in the data, not a statement about the place.`,
      );
    }

    // Area data is inherently less specific than a located offence, so it is
    // carried at lower confidence — and a gemeente figure, which is one number
    // for a whole city, lower still.
    const levelConfidence: Record<AreaLevel, number> = { buurt: 0.4, wijk: 0.34, gemeente: 0.22 };
    const coverage = summary.monthsObserved / Math.max(1, summary.monthsRequested);
    const confidence = levelConfidence[query.area.level] * (0.6 + 0.4 * coverage);

    const note =
      summary.suppressedCells > 0
        ? `${summary.suppressedCells} figures were withheld by CBS, usually because the counts are too small to publish. They are not counted as zero.`
        : undefined;

    return present(summary, sourceName, confidence, note);
  } catch (error) {
    // Every one of these is "we did not look", and must read that way.
    if (error instanceof UpstreamTimeoutError) {
      return absent("unreachable", sourceName, gapNote("The police crime figures", "unreachable"));
    }
    if (error instanceof UpstreamTransportError) {
      return absent("unreachable", sourceName, gapNote("The police crime figures", "unreachable"));
    }
    if (error instanceof UpstreamStatusError) {
      return absent(
        "unreachable",
        sourceName,
        `The police crime figures answered ${error.status}, so nothing was measured here. That is a gap in the data, not a statement about the place.`,
      );
    }
    return absent("unreachable", sourceName, gapNote("The police crime figures", "unreachable"));
  }
}

/**
 * 47024NED — registered NUISANCE, the same shape as the crime table. Street
 * drinking, loitering, harassment complaints: the things women actually
 * report, and which never reach a crime statistic at all.
 */
export async function fetchAreaNuisance(query: CrimeQuery): Promise<Signal<CrimeSummary>> {
  return fetchAreaCrime({
    ...query,
    table: query.table ?? "47024NED",
    topicHint: query.topicHint ?? "geregistreerdeoverlast",
  });
}
