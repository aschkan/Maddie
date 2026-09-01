/**
 * CBS StatLine OData v3, as used by the Dutch police crime tables.
 *
 * Everything here reads the table's own metadata rather than hard-coding
 * column names. Hard-coded columns are how an integration silently starts
 * returning zero rows — and zero rows is indistinguishable from zero crime,
 * which is the one failure this app must never produce.
 */
import { z } from "zod";
import { upstreamJson } from "../http/fetch.ts";

export const DataProperty = z
  .object({
    ID: z.number().optional(),
    Type: z.string(),
    Key: z.string(),
    Title: z.string().optional(),
    Description: z.string().optional(),
    Unit: z.string().optional(),
  })
  .loose();
export type DataProperty = z.infer<typeof DataProperty>;

const ODataEnvelope = z.object({ value: z.array(z.unknown()).default([]) });

export interface TableShape {
  /** The region column. On 47022NED this is `WijkenEnBuurten`. */
  regionKey: string;
  /** The period column. On 47022NED this is `Perioden`. */
  periodKey: string;
  /** Every other classifying dimension, e.g. `SoortMisdrijf`. */
  dimensionKeys: string[];
  /** Measure columns, e.g. `GeregistreerdeMisdrijven_1`. */
  topicKeys: string[];
}

/**
 * TRAP: `GeoDetail` does not contain the substring "Dimension". A test like
 * `Type.includes("Dimension")` finds the period and the offence type and
 * silently loses the region — and a table whose region column cannot be found
 * reads as unusable, which ends as no crime data at all.
 */
const REGION_TYPES = new Set(["GeoDimension", "GeoDetail"]);
const TIME_TYPES = new Set(["TimeDimension"]);
const PLAIN_TYPES = new Set(["Dimension"]);
const TOPIC_TYPES = new Set(["Topic"]);

export function resolveShape(properties: readonly DataProperty[]): TableShape | null {
  let regionKey: string | null = null;
  let periodKey: string | null = null;
  const dimensionKeys: string[] = [];
  const topicKeys: string[] = [];

  for (const property of properties) {
    const type = property.Type.trim();
    if (REGION_TYPES.has(type)) regionKey ??= property.Key;
    else if (TIME_TYPES.has(type)) periodKey ??= property.Key;
    else if (PLAIN_TYPES.has(type)) dimensionKeys.push(property.Key);
    else if (TOPIC_TYPES.has(type)) topicKeys.push(property.Key);
  }

  if (regionKey === null || periodKey === null || topicKeys.length === 0) return null;
  return { regionKey, periodKey, dimensionKeys, topicKeys };
}

/**
 * TRAP: CBS appends `_1`, `_2`… to a topic key when its name collides with
 * something else in the table, so `GeregistreerdeMisdrijven` is really
 * `GeregistreerdeMisdrijven_1`. The lookup has to be a substring test.
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

export function odataQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * TRAP: month codes must be ENUMERATED, never compared with `ge`/`le`.
 * `Perioden ge '2025MM01'` is a lexicographic range, and the same column also
 * holds the annual codes `2025JJ00` — so the year's own total is added to the
 * twelve months that make it up and every figure roughly triples.
 */
export function periodFilter(periodKey: string, periods: readonly string[]): string {
  if (periods.length === 0) return "";
  return `(${periods.map((period) => `${periodKey} eq ${odataQuote(period)}`).join(" or ")})`;
}

export function andFilters(parts: readonly (string | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part !== "").join(" and ");
}

export interface CodeLabel {
  key: string;
  title: string;
}

const CodeRow = z.object({ Key: z.string(), Title: z.string().optional() }).loose();

export function parseCodeList(raw: unknown): CodeLabel[] {
  const envelope = ODataEnvelope.safeParse(raw);
  if (!envelope.success) return [];
  const out: CodeLabel[] = [];
  for (const row of envelope.data.value) {
    const parsed = CodeRow.safeParse(row);
    if (!parsed.success) continue;
    out.push({ key: parsed.data.Key, title: (parsed.data.Title ?? parsed.data.Key).trim() });
  }
  return out;
}

export function parseDataProperties(raw: unknown): DataProperty[] {
  const envelope = ODataEnvelope.safeParse(raw);
  if (!envelope.success) return [];
  const out: DataProperty[] = [];
  for (const row of envelope.data.value) {
    const parsed = DataProperty.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function parseTypedDataSet(raw: unknown): Array<Record<string, unknown>> {
  const envelope = ODataEnvelope.safeParse(raw);
  if (!envelope.success) return [];
  return envelope.data.value.filter(
    (row): row is Record<string, unknown> => row !== null && typeof row === "object" && !Array.isArray(row),
  );
}

export interface StatLineClient {
  base: string;
  table: string;
}

export function statlineUrl(client: StatLineClient, path: string, query?: Record<string, string>): string {
  const url = new URL(`${client.base}/${client.table}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function fetchDataProperties(client: StatLineClient): Promise<DataProperty[]> {
  return parseDataProperties(await upstreamJson(statlineUrl(client, "/DataProperties")));
}

export async function fetchCodeList(
  client: StatLineClient,
  dimension: string,
  startsWith?: string,
): Promise<CodeLabel[]> {
  const query: Record<string, string> = { $select: "Key,Title" };
  // CBS pads region keys to a fixed width with trailing spaces, so an
  // `eq 'BU03630000'` filter matches nothing at all. `startswith` does.
  if (startsWith !== undefined && startsWith !== "") {
    query.$filter = `startswith(Key,${odataQuote(startsWith)})`;
  }
  return parseCodeList(await upstreamJson(statlineUrl(client, `/${dimension}`, query)));
}

export async function fetchTypedDataSet(
  client: StatLineClient,
  filter: string,
  select?: string,
): Promise<Array<Record<string, unknown>>> {
  const query: Record<string, string> = {};
  if (filter !== "") query.$filter = filter;
  if (select !== undefined && select !== "") query.$select = select;
  return parseTypedDataSet(await upstreamJson(statlineUrl(client, "/TypedDataSet", query)));
}

export interface TableInfo {
  identifier: string;
  title: string;
  shortDescription: string;
  period: string;
  modified: string;
}

const TableInfoRow = z
  .object({
    Identifier: z.string().optional(),
    Title: z.string().optional(),
    ShortDescription: z.string().optional(),
    Period: z.string().optional(),
    Modified: z.string().optional(),
  })
  .loose();

export function parseTableInfos(raw: unknown): TableInfo | null {
  const envelope = ODataEnvelope.safeParse(raw);
  if (!envelope.success || envelope.data.value.length === 0) return null;
  const parsed = TableInfoRow.safeParse(envelope.data.value[0]);
  if (!parsed.success) return null;
  return {
    identifier: parsed.data.Identifier ?? "",
    title: (parsed.data.Title ?? "").trim(),
    shortDescription: (parsed.data.ShortDescription ?? "").trim(),
    period: (parsed.data.Period ?? "").trim(),
    modified: (parsed.data.Modified ?? "").trim(),
  };
}

export async function fetchTableInfo(client: StatLineClient): Promise<TableInfo | null> {
  return parseTableInfos(await upstreamJson(statlineUrl(client, "/TableInfos")));
}
