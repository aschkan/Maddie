import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowedOrigins,
  isAllowedUrl,
  rewriteStyle,
  safePath,
  toLocalUrl,
  upstreamUrlFor,
  DEFAULT_TILE_UPSTREAM,
} from "../src/lib/map/proxy.ts";

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
