/**
 * The vector basemap the navigation view tilts. Pure parts, tested.
 *
 * The rest of this app draws raster tiles with Leaflet: flat pictures, north
 * up, which is all a planning map needs. A navigation view wants to tilt and to
 * turn with you, and a picture cannot be tilted — the labels would tilt with
 * it. That needs vector tiles and a GPU renderer, which is MapLibre.
 *
 * **The source is OpenFreeMap**: free, no key, no signup, no request limit.
 * That is the same deal every other upstream here is on, and it is why it was
 * picked over the providers that want an API key — this app has exactly one
 * secret and is not gaining another for a basemap.
 *
 * ⚠ THE WHOLE POINT OF THIS FILE is `rewriteStyle`. Read its comment before
 * changing anything here.
 */

/** Where the style lives, through this server's forwarder. */
export const VECTOR_STYLE = "/api/osm/vector/styles/liberty";

/** The host the style's own URLs point at, and which must not be reached. */
export const VECTOR_HOST = "https://tiles.openfreemap.org";

/** Everything from that host is fetched through here instead. */
export const VECTOR_PREFIX = "/api/osm/vector";

/**
 * Point every URL in a MapLibre style back at this server.
 *
 * A style JSON is mostly a list of absolute URLs: the tile endpoints, the glyph
 * ranges that render every label, the sprite sheet behind every icon. Handed to
 * MapLibre unmodified it fetches the style through the forwarder and then goes
 * straight to OpenFreeMap for all the rest — which is the exact bypass the
 * forwarder exists to prevent, and which blanks the map entirely on the machine
 * that cannot reach the internet at all.
 *
 * So the whole object is walked and every URL on that host is rewritten. Walked
 * rather than patched field by field: `sources` can hold tile arrays, a TileJSON
 * `url`, or both; `glyphs` and `sprite` are top-level; `sprite` may be a string
 * or a list of named sheets in newer styles. Naming the fields means missing one
 * the day the upstream style changes shape, and a missing one is a silent
 * request straight out of the browser.
 *
 * Protocol-relative and bare-path URLs are left alone: the first are not this
 * host, and the second are already relative to this server.
 */
export function rewriteStyle<T>(style: T, host: string = VECTOR_HOST, prefix: string = VECTOR_PREFIX): T {
  const swap = (value: string): string =>
    value.startsWith(host) ? prefix + value.slice(host.length) : value;

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return swap(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) out[key] = walk(item);
      return out;
    }
    return node;
  };

  return walk(style) as T;
}

/**
 * Did the rewrite actually catch everything?
 *
 * A style that still names the upstream host is a style that will reach around
 * this server the moment it is rendered, and it fails INVISIBLY on the machine
 * where that works — the map looks perfect in development and is blank on the
 * box that needed the forwarder. So the result is checked rather than trusted,
 * and the navigation view falls back to the flat map when it is wrong.
 */
export function stillReachesOut(style: unknown, host: string = VECTOR_HOST): boolean {
  return JSON.stringify(style ?? null).includes(host);
}

/**
 * How the map is angled while navigating.
 *
 * 55° is what the phone apps settle on and it is not arbitrary: past about 60°
 * the horizon comes into frame and the far half of the screen is a smear of
 * labels at two pixels tall, and under about 40° it reads as a flat map that
 * happens to be crooked. This is far enough to show the next junction in
 * context and no further.
 */
export const NAV_PITCH = 55;

/** Close enough to read street names, wide enough to see the next turn. */
export const NAV_ZOOM = 17.5;
