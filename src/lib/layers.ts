/**
 * The map layers — what gets drawn on top of the streets.
 *
 * One data source: OpenStreetMap, through Overpass, from the browser. Every
 * category below is a real tag somebody mapped, so a marker on the screen
 * stands for a record you can go and look at. Nothing here is inferred, and
 * where a tag is only a proxy for what was asked for, the note says so.
 */

import { endpoint, forwarderFailure, unreachableMessage } from "./endpoints.ts";
import type { LatLng } from "./osrm.ts";

export interface SpotKind {
  id: string;
  label: string;
  /** The Overpass tag filter, without the area clause. */
  match: string;
  icon: string;
  /** Shown beside the checkbox: what the tag does and does not mean. */
  note?: string;
}

/**
 * Safe spots — the pink hearts.
 *
 * Somewhere with a door, a light and usually a person: places to walk towards.
 * That is the whole claim. A police station at 3 a.m. may be locked and a
 * supermarket may have closed an hour ago, so the popup shows the opening
 * hours OSM holds rather than this deciding for you.
 */
export const SAFE_SPOTS: SpotKind[] = [
  { id: "taxi", label: "Taxi rank", match: '["amenity"="taxi"]', icon: "🚕" },
  { id: "police", label: "Police station", match: '["amenity"="police"]', icon: "🛡️" },
  { id: "hospital", label: "Hospital", match: '["amenity"~"^(hospital|clinic)$"]', icon: "🏥" },
  { id: "fire", label: "Fire station", match: '["amenity"="fire_station"]', icon: "🚒" },
  {
    id: "gym24",
    label: "24/7 gym",
    match: '["leisure"="fitness_centre"]["opening_hours"="24/7"]',
    icon: "🏋️",
    note: "Only gyms tagged 24/7 — a Basic-Fit without the tag will not appear",
  },
  { id: "mall", label: "Shopping centre", match: '["shop"="mall"]', icon: "🛍️" },
  { id: "supermarket", label: "Supermarket", match: '["shop"="supermarket"]', icon: "🛒" },
  { id: "fuel", label: "Petrol station", match: '["amenity"="fuel"]', icon: "⛽",
    note: "Usually staffed and lit late" },
  { id: "bar", label: "Bar or café", match: '["amenity"~"^(bar|pub|cafe|restaurant|fast_food)$"]', icon: "☕" },
  { id: "library", label: "Library", match: '["amenity"="library"]', icon: "📚" },
  { id: "pharmacy", label: "Pharmacy", match: '["amenity"="pharmacy"]', icon: "💊" },
  {
    id: "busy",
    label: "Busy streets & squares",
    match: '["highway"="pedestrian"]',
    icon: "🚶",
    note: "Pedestrianised streets — a stand-in for footfall, which OSM does not record",
  },
  { id: "transit", label: "Train or metro", match: '["railway"~"^(station|subway_entrance|tram_stop)$"]', icon: "🚉" },
];

const BY_ID = new Map(SAFE_SPOTS.map((kind) => [kind.id, kind]));

export interface Spot {
  id: string;
  kind: string;
  label: string;
  icon: string;
  name?: string;
  point: LatLng;
  openingHours?: string;
}

export interface Lamp {
  id: string;
  point: LatLng;
}

/** A street OSM records as lit. Drawn as a yellow line along the street. */
export interface LitWay {
  id: string;
  name?: string;
  path: LatLng[];
}

export interface LayerData {
  spots: Spot[];
  lamps: Lamp[];
  litWays: LitWay[];
  /** True when a reply hit its element cap — what you see is part of it. */
  truncated: boolean;
}

export const EMPTY_LAYERS: LayerData = { spots: [], lamps: [], litWays: [], truncated: false };

interface Element {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
  geometry?: { lat?: number; lon?: number }[];
}

const MAX_SPOTS = 600;
const MAX_LAMPS = 800;
/** Full geometry is far heavier per element, so this cap is much lower. */
const MAX_LIT_WAYS = 400;

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * One query for every layer that is switched on, over the visible map.
 *
 * Bounded by the screen rather than by the route: these are things to look at
 * while panning around, and tying the query to the route would leave the map
 * empty the moment you moved off it.
 *
 * Three named sets rather than one union, because the three want different
 * `out` statements — a marker needs only a centre point, but a lit street has
 * to be drawn as a line, and asking for full geometry on everything multiplies
 * the payload for no gain.
 */
export function layerQuery(
  bbox: BBox,
  kinds: readonly string[],
  wantLighting: boolean,
  timeoutS = 25,
): string | null {
  const box = `${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)}`;
  const wanted = SAFE_SPOTS.filter((kind) => kinds.includes(kind.id));
  if (wanted.length === 0 && !wantLighting) return null;

  const parts: string[] = [`[out:json][timeout:${timeoutS}];`];

  if (wanted.length > 0) {
    const clauses: string[] = [];
    for (const kind of wanted) {
      // Both node and way: a bus shelter is a point, a hospital is a building.
      // `nwr` would also pull relations, which these rarely are and which cost
      // an extra resolution step apiece.
      clauses.push(`  node${kind.match}(${box});`);
      clauses.push(`  way${kind.match}(${box});`);
    }
    parts.push(`(\n${clauses.join("\n")}\n)->.spots;`);
    // `center` collapses a building to the one point a marker needs.
    parts.push(`.spots out tags center ${MAX_SPOTS};`);
  }

  if (wantLighting) {
    parts.push(`node["highway"="street_lamp"](${box})->.lamps;`);
    parts.push(`.lamps out ${MAX_LAMPS};`);
    // `lit=yes` on the street itself is most of a city's lighting: lamps are
    // mapped one by one and only in places somebody has surveyed on foot.
    parts.push(`way["highway"]["lit"="yes"](${box})->.lit;`);
    parts.push(`.lit out tags geom ${MAX_LIT_WAYS};`);
  }

  return parts.join("\n");
}

/** Which kind an element belongs to, by the tags it carries. */
export function classify(tags: Record<string, string>): SpotKind | null {
  for (const kind of SAFE_SPOTS) {
    const pairs = [...kind.match.matchAll(/\["([^"]+)"(=|~)"([^"]+)"\]/g)];
    if (pairs.length === 0) continue;
    const every = pairs.every(([, key, operator, value]) => {
      const actual = tags[key ?? ""];
      if (actual === undefined) return false;
      if (operator === "=") return actual === value;
      try {
        return new RegExp(value ?? "").test(actual);
      } catch {
        return false;
      }
    });
    if (every) return kind;
  }
  return null;
}

/**
 * `opening_hours` as OSM holds it, without pretending to have read it.
 *
 * The syntax is a small language — `Mo-Fr 09:00-18:00; Sa 10:00-16:00; PH
 * off` — and half-parsing it produces a confident "Open now" for a shop that
 * shut at six. At 2 a.m., walking towards a closed door because this app said
 * it was open is exactly the harm to avoid, so only `24/7` is interpreted: it
 * is the one value with no room for a wrong reading. Everything else is shown
 * as written.
 */
export function alwaysOpen(openingHours: string | undefined): boolean {
  return openingHours?.trim() === "24/7";
}

export function parseLayers(reply: unknown): LayerData {
  const body = reply as { elements?: Element[] } | null;
  const elements = Array.isArray(body?.elements) ? body.elements : [];

  const spots: Spot[] = [];
  const lamps: Lamp[] = [];
  const litWays: LitWay[] = [];
  const seen = new Set<string>();

  for (const element of elements) {
    const tags = element.tags ?? {};
    const key = `${element.type}/${element.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // A lit street arrives as geometry, not as a point.
    if (Array.isArray(element.geometry) && tags.lit === "yes") {
      const path: LatLng[] = [];
      for (const node of element.geometry) {
        if (typeof node?.lat !== "number" || typeof node?.lon !== "number") continue;
        if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) continue;
        path.push({ lat: node.lat, lng: node.lon });
      }
      if (path.length >= 2) litWays.push({ id: key, name: tags.name, path });
      continue;
    }

    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    if (tags.highway === "street_lamp") {
      lamps.push({ id: key, point: { lat, lng: lon } });
      continue;
    }

    const kind = classify(tags);
    if (!kind) continue;
    spots.push({
      id: key,
      kind: kind.id,
      label: kind.label,
      icon: kind.icon,
      name: tags.name,
      point: { lat, lng: lon },
      openingHours: tags.opening_hours,
    });
  }

  return {
    spots,
    lamps,
    litWays,
    truncated: spots.length >= MAX_SPOTS || lamps.length >= MAX_LAMPS || litWays.length >= MAX_LIT_WAYS,
  };
}

export function spotKind(id: string): SpotKind | undefined {
  return BY_ID.get(id);
}

export const DEFAULT_OVERPASS = endpoint("overpass");

export async function fetchLayers(
  bbox: BBox,
  kinds: readonly string[],
  wantLighting: boolean,
  options: { base?: string; signal?: AbortSignal } = {},
): Promise<{ ok: true; data: LayerData } | { ok: false; error: string }> {
  const query = layerQuery(bbox, kinds, wantLighting);
  if (!query) return { ok: true, data: EMPTY_LAYERS };

  try {
    const response = await fetch(options.base ?? DEFAULT_OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: options.signal,
    });
    if (response.status === 504) {
      return { ok: false, error: "The map query timed out. Zoom in, or switch off a layer or two." };
    }
    if (response.status === 429) {
      return { ok: false, error: "OpenStreetMap is rate limiting us. Wait a moment, then pan again." };
    }
    const ours = forwarderFailure("overpass", response.status);
    if (ours) return { ok: false, error: ours };
    if (!response.ok) return { ok: false, error: `OpenStreetMap answered ${response.status}.` };
    return { ok: true, data: parseLayers(await response.json()) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, error: "cancelled" };
    }
    return { ok: false, error: unreachableMessage("overpass", "OpenStreetMap") + " The layers are not loaded." };
  }
}
