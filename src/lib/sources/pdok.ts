/**
 * PDOK Locatieserver — the Dutch government's own geocoder, over the BAG
 * address register. Free, keyless, statutory, no rate limit, and — the reason
 * it is first rather than Nominatim — it returns the CBS neighbourhood codes
 * the police crime figures are published against. Without those there is no
 * way to ask "what happened on this street" at all.
 */
import { z } from "zod";
import { getConfig } from "../config.ts";
import { upstreamJson, UpstreamTimeoutError, UpstreamTransportError } from "../http/fetch.ts";
import { parseWktPoint, type LatLng } from "../geo/wkt.ts";

export type AreaLevel = "buurt" | "wijk" | "gemeente";

export interface AreaCode {
  level: AreaLevel;
  /** Normalised StatLine code, e.g. BU03630000 / WK036300 / GM0363. */
  code: string;
  name: string;
}

export interface GeoPlace {
  id: string;
  label: string;
  type: string;
  point: LatLng;
  /** Most specific first: buurt, then wijk, then gemeente. */
  areas: AreaCode[];
  municipality: string | null;
  province: string | null;
  postcode: string | null;
  source: "pdok" | "nominatim";
}

const PdokDoc = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    weergavenaam: z.string().optional(),
    centroide_ll: z.string().optional(),
    buurtcode: z.string().optional(),
    buurtnaam: z.string().optional(),
    wijkcode: z.string().optional(),
    wijknaam: z.string().optional(),
    gemeentecode: z.string().optional(),
    gemeentenaam: z.string().optional(),
    provincienaam: z.string().optional(),
    postcode: z.string().optional(),
  })
  .loose();

const PdokResponse = z.object({
  response: z.object({
    numFound: z.number().optional(),
    docs: z.array(PdokDoc).default([]),
  }),
});

export type PdokDoc = z.infer<typeof PdokDoc>;

/**
 * StatLine writes region codes with a letter prefix and a fixed width; PDOK
 * sometimes hands back the bare number. `0363` is Amsterdam either way, but
 * only `GM0363` will ever match a row in the crime table.
 */
export function normaliseAreaCode(level: AreaLevel, raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "") return null;
  const prefix = level === "buurt" ? "BU" : level === "wijk" ? "WK" : "GM";
  const digits = trimmed.replace(/^(BU|WK|GM)/, "");
  if (!/^\d+$/.test(digits)) return null;
  const width = level === "buurt" ? 8 : level === "wijk" ? 6 : 4;
  return `${prefix}${digits.padStart(width, "0")}`;
}

export function parsePdokDoc(raw: unknown): GeoPlace | null {
  const parsed = PdokDoc.safeParse(raw);
  if (!parsed.success) return null;
  const doc = parsed.data;
  const point = parseWktPoint(doc.centroide_ll);
  if (point === null) return null;

  const areas: AreaCode[] = [];
  const buurt = normaliseAreaCode("buurt", doc.buurtcode);
  if (buurt !== null) areas.push({ level: "buurt", code: buurt, name: doc.buurtnaam ?? buurt });
  const wijk = normaliseAreaCode("wijk", doc.wijkcode);
  if (wijk !== null) areas.push({ level: "wijk", code: wijk, name: doc.wijknaam ?? wijk });
  const gemeente = normaliseAreaCode("gemeente", doc.gemeentecode);
  if (gemeente !== null) areas.push({ level: "gemeente", code: gemeente, name: doc.gemeentenaam ?? gemeente });

  return {
    id: doc.id ?? `${point.lat},${point.lng}`,
    label: doc.weergavenaam ?? "",
    type: doc.type ?? "onbekend",
    point,
    areas,
    municipality: doc.gemeentenaam ?? null,
    province: doc.provincienaam ?? null,
    postcode: doc.postcode ?? null,
    source: "pdok",
  };
}

export function parsePdokResponse(raw: unknown): GeoPlace[] {
  const parsed = PdokResponse.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.response.docs
    .map((doc) => parsePdokDoc(doc))
    .filter((place): place is GeoPlace => place !== null);
}

/** Everything PDOK can tell us, or an honest reason why it could not. */
export type PdokOutcome =
  | { ok: true; places: GeoPlace[] }
  | { ok: false; reason: "unreachable" | "timeout" | "error"; detail: string };

async function query(path: string, params: Record<string, string>): Promise<PdokOutcome> {
  const config = getConfig();
  const url = new URL(`${config.pdokUrl}${path}`);
  // `fl=*` is what makes the neighbourhood codes come back at all; the default
  // field list is display-only.
  url.searchParams.set("fl", "*");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    const body = await upstreamJson(url.toString());
    return { ok: true, places: parsePdokResponse(body) };
  } catch (error) {
    // A 404 because there is no such address and a 404 because the geocoder
    // timed out must never arrive at the caller looking the same.
    if (error instanceof UpstreamTimeoutError) return { ok: false, reason: "timeout", detail: error.message };
    if (error instanceof UpstreamTransportError) return { ok: false, reason: "unreachable", detail: error.message };
    return { ok: false, reason: "error", detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function pdokFree(text: string, rows = 8): Promise<PdokOutcome> {
  return query("/free", { q: text, rows: String(rows) });
}

export async function pdokSuggest(text: string, rows = 8): Promise<PdokOutcome> {
  return query("/suggest", { q: text, rows: String(rows) });
}

export async function pdokReverse(point: LatLng, rows = 1): Promise<PdokOutcome> {
  return query("/reverse", {
    lat: String(point.lat),
    lon: String(point.lng),
    rows: String(rows),
    type: "adres",
  });
}

/**
 * Most specific first. A buurt is a few streets; a gemeente is all of
 * Amsterdam, and one figure for all of Amsterdam is the same number on the
 * safest street and the worst one — so it is a last resort, flagged as such.
 */
export function mostSpecificArea(place: GeoPlace): AreaCode | null {
  const order: AreaLevel[] = ["buurt", "wijk", "gemeente"];
  for (const level of order) {
    const found = place.areas.find((area) => area.level === level);
    if (found) return found;
  }
  return null;
}
