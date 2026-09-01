/**
 * The basemap is served BY THIS APP at /api/map/*.
 *
 * Every other upstream is fetched server-side, so the forward proxy covers it.
 * Tiles are fetched by the BROWSER — and a browser on a blocked network, or a
 * phone that cannot see the LAN proxy, gets zoom controls, attribution and no
 * ground at all.
 *
 * Fetching the style document through the route is not enough on its own: a
 * MapLibre style is a document FULL of absolute URLs (`sources[].tiles`,
 * `sources[].url`, `sprite`, `glyphs`, and whatever the next spec version
 * adds), and the browser will go straight to the tile host for each one. So
 * every string in the document is rewritten, not the three fields that happen
 * to hold URLs today.
 *
 * Security: the upstream host is FIXED IN CODE and allowlisted by ORIGIN. The
 * difference between a tile proxy and an open proxy is that the target can
 * never come from the request.
 */

/** The only hosts this route will ever fetch from. Not configurable per request. */
export const DEFAULT_TILE_UPSTREAM = "https://tiles.openfreemap.org";

/** Where the browser asks for the style when nothing overrides it: this app. */
export const DEFAULT_MAP_STYLE_URL = "/api/map/styles/liberty";

/**
 * The style URL the browser should use, given whatever was configured.
 *
 * An EMPTY value is an ABSENT one — the same rule `str()` applies in config.ts,
 * and the two have to agree because they read the same key from opposite sides.
 * They did not. The env file says "Leave both blank", so
 * `NEXT_PUBLIC_MAP_STYLE_URL=` is the documented setup; Next inlines that as
 * `""` at build time; and `?? DEFAULT` keeps it, because an empty string is not
 * nullish. The server resolved the same key to this default and reported
 * `basemap.servedByApp: true` in /api/health while the browser handed MapLibre
 * an empty URL and logged "There is no style added to the map."
 *
 * A blank map, no failed request to find in the network tab, and the two halves
 * of the app disagreeing about whether the basemap was configured at all.
 */
export function resolveMapStyleUrl(configured: string | undefined): string {
  const trimmed = (configured ?? "").trim();
  return trimmed === "" ? DEFAULT_MAP_STYLE_URL : trimmed;
}

export function allowedOrigins(configured: string): string[] {
  const origins = new Set<string>();
  for (const candidate of [DEFAULT_TILE_UPSTREAM, configured]) {
    if (candidate === "") continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      /* an unparseable upstream is simply not allowed */
    }
  }
  return [...origins];
}

/**
 * Origin equality, never `startsWith`. `https://tiles.openfreemap.org.evil.test/`
 * passes a prefix test and must not pass this one.
 */
export function isAllowedUrl(url: string, origins: readonly string[]): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return origins.includes(parsed.origin);
  } catch {
    return false;
  }
}

/** Path traversal is rejected outright rather than normalised away. */
export function safePath(segments: readonly string[]): string | null {
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment.includes("..")) return null;
    if (segment.includes("\\") || segment.includes("\0")) return null;
  }
  return segments
    .map((segment) => encodeURIComponent(segment).replace(/%7B/gi, "{").replace(/%7D/gi, "}"))
    .join("/");
}

export function upstreamUrlFor(segments: readonly string[], upstream: string, search: string): string | null {
  const path = safePath(segments);
  if (path === null) return null;
  const base = upstream === "" ? DEFAULT_TILE_UPSTREAM : upstream;
  const url = `${base.replace(/\/+$/, "")}/${path}${search}`;
  return isAllowedUrl(url, allowedOrigins(upstream)) ? url : null;
}

/**
 * The public origin this response is being viewed at — scheme://host[:port].
 *
 * MapLibre REQUIRES an absolute `sprite` and rejects the root-relative path the
 * rewrite below produces ("Invalid sprite URL … must be absolute"), so the
 * style has to name an origin. It cannot be taken from `request.url`: behind
 * the proxy that is the loopback upstream (127.0.0.1:8087), and a sprite URL
 * pointing there is unreachable for everyone but the server itself.
 *
 * So: the forwarded headers the proxy sets, then Host, then the request's own
 * origin. Only ever used to address THIS app, never to choose an upstream — the
 * tile host is fixed in code, and nothing here can move it.
 */
export function publicOrigin(headers: Headers, fallback: string): string {
  // A proxy chain appends, so the first entry is the client-facing one.
  const first = (raw: string | null): string => ((raw ?? "").split(",")[0] ?? "").trim();
  const host = first(headers.get("x-forwarded-host")) || first(headers.get("host"));
  if (host === "") return fallback;
  const forwarded = first(headers.get("x-forwarded-proto")).toLowerCase();
  const scheme = forwarded === "http" || forwarded === "https" ? forwarded : fallback.startsWith("https:") ? "https" : "http";
  try {
    return new URL(`${scheme}://${host}`).origin;
  } catch {
    return fallback;
  }
}

/**
 * URL pointing back at this app's own route, preserving the query string.
 * Absolute when `mount` is absolute — which is how the sprite gets a scheme.
 */
export function toLocalUrl(url: string, origins: readonly string[], mount = "/api/map"): string {
  if (!isAllowedUrl(url, origins)) return url;
  const parsed = new URL(url);
  // `URL` percent-encodes the braces in tile and glyph templates; MapLibre
  // needs them back, or it asks for a literal "%7Bz%7D" tile.
  const pathname = parsed.pathname.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
  return `${mount}${pathname}${parsed.search}`;
}

/**
 * Walking the basemap chain, for the health probe.
 *
 * A style names sources; a source is EITHER a TileJSON URL to fetch or an
 * inline list of tile templates. Conflating the two is how the probe's first
 * version reported a 404 that was its own fault: it took `tiles[0]` from a
 * raster source and fetched "…/{z}/{x}/{y}.png" verbatim, which no tile host
 * will ever serve. The distinction is the whole point of walking the chain.
 */
export interface StyleSource {
  id: string;
  /** A TileJSON document to fetch, if the source names one. */
  url: string | null;
  /** A `{z}/{x}/{y}` template, if the source lists tiles inline. */
  tileTemplate: string | null;
}

export function styleSources(style: unknown): StyleSource[] {
  if (style === null || typeof style !== "object") return [];
  const sources = (style as { sources?: unknown }).sources;
  if (sources === null || typeof sources !== "object") return [];
  const out: StyleSource[] = [];
  for (const [id, source] of Object.entries(sources as Record<string, unknown>)) {
    if (source === null || typeof source !== "object") continue;
    const rawUrl = (source as { url?: unknown }).url;
    const rawTiles = (source as { tiles?: unknown }).tiles;
    const url = typeof rawUrl === "string" && rawUrl !== "" ? rawUrl : null;
    const first = Array.isArray(rawTiles) && typeof rawTiles[0] === "string" && rawTiles[0] !== "" ? rawTiles[0] : null;
    if (url === null && first === null) continue;
    out.push({ id, url, tileTemplate: first });
  }
  return out;
}

export function firstTileTemplate(tilejson: unknown): string | null {
  if (tilejson === null || typeof tilejson !== "object") return null;
  const tiles = (tilejson as { tiles?: unknown }).tiles;
  if (Array.isArray(tiles) && typeof tiles[0] === "string" && tiles[0] !== "") return tiles[0];
  return null;
}

/** Does this URL still have placeholders in it? Then it is not fetchable yet. */
export function isTileTemplate(url: string): boolean {
  return /\{[zxy]\}/i.test(url);
}

/** `{z}/{x}/{y}` → real numbers. Case-insensitive; anything else is left alone. */
export function fillTileTemplate(template: string, z: number, x: number, y: number): string {
  return template
    .replace(/\{z\}/gi, String(z))
    .replace(/\{x\}/gi, String(x))
    .replace(/\{y\}/gi, String(y));
}

const ATTRIBUTION_KEYS = new Set(["attribution", "copyright", "license", "licence"]);

/**
 * Rewrites every string in the document. Attribution strings are left ALONE:
 * keeping the OpenStreetMap credit is a licence obligation, and a blanket URL
 * rewrite eats the link inside it.
 */
export function rewriteStyle(value: unknown, origins: readonly string[], mount = "/api/map", key = ""): unknown {
  if (typeof value === "string") {
    if (ATTRIBUTION_KEYS.has(key.toLowerCase())) return value;
    return toLocalUrl(value, origins, mount);
  }
  if (Array.isArray(value)) return value.map((item) => rewriteStyle(item, origins, mount, key));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = rewriteStyle(childValue, origins, mount, childKey);
    }
    return out;
  }
  return value;
}

/** TileJSON comes back through the same route and gets the same treatment. */
export function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  return /json/i.test(contentType);
}
