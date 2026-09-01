import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedOrigins,
  isAllowedUrl,
  rewriteStyle,
  safePath,
  toLocalUrl,
  upstreamUrlFor,
  publicOrigin,
  firstSourceUrl,
  firstTileTemplate,
  fillTileTemplate,
  resolveMapStyleUrl,
  DEFAULT_TILE_UPSTREAM,
  DEFAULT_MAP_STYLE_URL,
} from "../src/lib/map/proxy.ts";
import { loadConfig } from "../src/lib/config.ts";

const origins = allowedOrigins("");

test("a look-alike host does not match the allowlist", () => {
  assert.equal(isAllowedUrl("https://tiles.openfreemap.org/styles/liberty", origins), true);
  assert.equal(isAllowedUrl("https://tiles.openfreemap.org.evil.test/styles/liberty", origins), false);
  assert.equal(isAllowedUrl("https://evil.test/?x=https://tiles.openfreemap.org", origins), false);
  assert.equal(isAllowedUrl("file:///etc/passwd", origins), false);
});

test("path traversal is rejected, not normalised", () => {
  assert.equal(safePath(["styles", "liberty"]), "styles/liberty");
  assert.equal(safePath(["..", "etc", "passwd"]), null);
  assert.equal(safePath(["styles", "..%2f.."]), null);
  assert.equal(safePath([]), null);
  assert.equal(upstreamUrlFor(["..", "x"], "", ""), null);
});

test("tile templates survive the path encoder", () => {
  assert.equal(
    upstreamUrlFor(["planet", "20250101", "{z}", "{x}", "{y}.pbf"], "", ""),
    `${DEFAULT_TILE_UPSTREAM}/planet/20250101/{z}/{x}/{y}.pbf`,
  );
});

test("the target can never come from the request", () => {
  // Even if a caller writes an absolute URL into the path, the upstream is
  // built from the fixed base — so it stays on the allowed origin.
  const url = upstreamUrlFor(["https:", "evil.test", "a"], "", "");
  assert.ok(url === null || url.startsWith(DEFAULT_TILE_UPSTREAM));
});

test("every string in the style is rewritten, not just the three URL fields", () => {
  const style = {
    version: 8,
    name: "Liberty",
    sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      openmaptiles: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        tiles: ["https://tiles.openfreemap.org/planet/20250101/{z}/{x}/{y}.pbf"],
        attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
      },
      // A field the spec adds later must be covered by the same sweep.
      future: { someNewUrlField: "https://tiles.openfreemap.org/whatever.json" },
    },
    layers: [{ id: "background", type: "background" }],
  };

  const rewritten = rewriteStyle(style, origins) as typeof style;
  assert.equal(rewritten.sprite, "/api/map/sprites/ofm_f384/ofm");
  assert.equal(rewritten.glyphs, "/api/map/fonts/{fontstack}/{range}.pbf");
  assert.equal(rewritten.sources.openmaptiles.url, "/api/map/planet");
  assert.equal(rewritten.sources.openmaptiles.tiles[0], "/api/map/planet/20250101/{z}/{x}/{y}.pbf");
  assert.equal(rewritten.sources.future.someNewUrlField, "/api/map/whatever.json");
  assert.ok(!JSON.stringify(rewritten).includes("tiles.openfreemap.org/planet"));
});

test("the OpenStreetMap attribution survives the rewrite — it is a licence obligation", () => {
  const style = {
    sources: {
      a: { attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' },
    },
  };
  const rewritten = rewriteStyle(style, origins) as typeof style;
  assert.ok(rewritten.sources.a.attribution.includes("openstreetmap.org/copyright"));
  assert.ok(rewritten.sources.a.attribution.includes("OpenStreetMap contributors"));
});

test("URLs that are not ours are left exactly as they are", () => {
  assert.equal(toLocalUrl("https://example.test/a.png", origins), "https://example.test/a.png");
  assert.equal(toLocalUrl("not a url", origins), "not a url");
});

/*
 * TRAP: an EMPTY NEXT_PUBLIC_MAP_STYLE_URL is an ABSENT one.
 *
 * The env file says "Leave both blank", so blank is the documented setup. Next
 * inlines a blank as "" at build time, and `?? DEFAULT` keeps it — an empty
 * string is not nullish. MapView handed MapLibre "" and logged "There is no
 * style added to the map."; the server resolved the same key to the default and
 * reported basemap.servedByApp: true. A blank map with nothing failing.
 */
test("a blank style URL resolves to the app's own basemap, not to nothing", () => {
  assert.equal(resolveMapStyleUrl(""), DEFAULT_MAP_STYLE_URL);
  assert.equal(resolveMapStyleUrl("   "), DEFAULT_MAP_STYLE_URL);
  assert.equal(resolveMapStyleUrl(undefined), DEFAULT_MAP_STYLE_URL);
});

test("a configured style URL is used as given, trimmed", () => {
  assert.equal(resolveMapStyleUrl("https://tiles.example/styles/x"), "https://tiles.example/styles/x");
  assert.equal(resolveMapStyleUrl("  https://tiles.example/styles/x  "), "https://tiles.example/styles/x");
});

test("the browser and the server agree on the style URL for the same env", () => {
  // The two read the same key from opposite sides. When they disagree,
  // /api/health says the basemap is served by the app while the map is blank.
  for (const configured of [undefined, "", "   ", "https://tiles.example/s"]) {
    const env = configured === undefined ? {} : { NEXT_PUBLIC_MAP_STYLE_URL: configured };
    assert.equal(resolveMapStyleUrl(configured), loadConfig(env).mapStyleUrl);
  }
});

/*
 * TRAP: MapLibre REQUIRES an absolute sprite URL.
 *
 * The rewrite pointed every URL at "/api/map/…", which is fine for tiles and
 * glyphs and fatal for the sprite: "Invalid sprite URL … must be absolute".
 * The basemap then draws its ground and none of its symbols, and the only
 * clue is one console line. So the mount has to carry an origin — and it
 * cannot come from request.url, which behind the proxy is the loopback
 * upstream nobody else can reach.
 */
test("the style mount can be absolute, so the sprite has a scheme", () => {
  const style = {
    sprite: "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: { ofm: { url: "https://tiles.openfreemap.org/planet" } },
  };
  const out = rewriteStyle(style, origins, "https://maddie.example/api/map") as typeof style;
  assert.equal(out.sprite, "https://maddie.example/api/map/sprites/ofm_f384/ofm");
  // The braces still survive the round trip through URL().
  assert.equal(out.glyphs, "https://maddie.example/api/map/fonts/{fontstack}/{range}.pbf");
  assert.equal(out.sources.ofm.url, "https://maddie.example/api/map/planet");
});

test("the public origin comes from the forwarded headers, not the loopback upstream", () => {
  const forwarded = new Headers({
    host: "127.0.0.1:8087",
    "x-forwarded-host": "maddie.arsaces.ir",
    "x-forwarded-proto": "https",
  });
  assert.equal(publicOrigin(forwarded, "http://127.0.0.1:8087"), "https://maddie.arsaces.ir");

  // Local test mode: plain HTTP, forwarded by the proxy on a laptop.
  const local = new Headers({ host: "localhost:9087", "x-forwarded-proto": "http" });
  assert.equal(publicOrigin(local, "http://127.0.0.1:8087"), "http://localhost:9087");
});

test("a missing, malformed or multi-valued forwarded header never wins over a usable fallback", () => {
  const fallback = "https://maddie.arsaces.ir";
  assert.equal(publicOrigin(new Headers(), fallback), fallback);
  assert.equal(publicOrigin(new Headers({ host: "" }), fallback), fallback);
  assert.equal(publicOrigin(new Headers({ host: " " }), fallback), fallback);
  // A proxy chain appends; the FIRST entry is the client-facing one.
  assert.equal(
    publicOrigin(new Headers({ "x-forwarded-host": "a.example, b.example", "x-forwarded-proto": "https, http" }), fallback),
    "https://a.example",
  );
  // An unknown scheme does not become part of the URL.
  assert.equal(publicOrigin(new Headers({ host: "a.example", "x-forwarded-proto": "gopher" }), fallback), "https://a.example");
  // A host carrying a path contributes only its origin.
  assert.equal(publicOrigin(new Headers({ host: "a.example/evil" }), fallback), "https://a.example");
});

/*
 * The basemap chain, for the health probe. A blank map looks the same whichever
 * link is broken, because the background colour and the attribution come from
 * the style — so a map whose every tile 404s still draws a tinted rectangle
 * with a credit in the corner. These walk the chain the browser walks.
 */
test("the first usable source URL is found, whether it is a TileJSON or inline tiles", () => {
  assert.equal(
    firstSourceUrl({ sources: { openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" } } }),
    "https://tiles.openfreemap.org/planet",
  );
  // Some styles skip the TileJSON and list templates directly.
  assert.equal(
    firstSourceUrl({ sources: { ofm: { type: "vector", tiles: ["https://t.example/{z}/{x}/{y}.pbf"] } } }),
    "https://t.example/{z}/{x}/{y}.pbf",
  );
  // A source with neither is skipped, not treated as the answer.
  assert.equal(
    firstSourceUrl({ sources: { empty: { type: "vector" }, real: { url: "https://t.example/planet" } } }),
    "https://t.example/planet",
  );
  assert.equal(firstSourceUrl({ sources: {} }), null);
  assert.equal(firstSourceUrl({}), null);
  assert.equal(firstSourceUrl(null), null);
  assert.equal(firstSourceUrl("not a style"), null);
});

test("the tile template is read from the TileJSON, and missing is null not a guess", () => {
  assert.equal(firstTileTemplate({ tiles: ["https://t.example/1/{z}/{x}/{y}.pbf"] }), "https://t.example/1/{z}/{x}/{y}.pbf");
  assert.equal(firstTileTemplate({ tiles: [] }), null);
  assert.equal(firstTileTemplate({}), null);
  assert.equal(firstTileTemplate(null), null);
});

test("a tile template becomes a real URL, in either case", () => {
  assert.equal(fillTileTemplate("https://t.example/{z}/{x}/{y}.pbf", 14, 8425, 5387), "https://t.example/14/8425/5387.pbf");
  assert.equal(fillTileTemplate("https://t.example/{Z}/{X}/{Y}.pbf", 1, 2, 3), "https://t.example/1/2/3.pbf");
  // Anything that is not z/x/y is left for whoever owns it (e.g. {ratio}).
  assert.equal(fillTileTemplate("https://t.example/{z}/{x}/{y}{ratio}.pbf", 1, 2, 3), "https://t.example/1/2/3{ratio}.pbf");
});
