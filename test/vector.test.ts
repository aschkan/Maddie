import test from "node:test";
import assert from "node:assert/strict";

import {
  NAV_PITCH, VECTOR_HOST, VECTOR_PREFIX, VECTOR_STYLE, rewriteStyle, stillReachesOut,
} from "../src/lib/vector.ts";

/** The shapes a real MapLibre style puts URLs in, all at once. */
function style() {
  return {
    version: 8,
    glyphs: `${VECTOR_HOST}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${VECTOR_HOST}/sprites/ofm_f384`,
    sources: {
      openmaptiles: {
        type: "vector",
        url: `${VECTOR_HOST}/planet`,
        tiles: [`${VECTOR_HOST}/planet/{z}/{x}/{y}.pbf`],
      },
      elsewhere: { type: "vector", tiles: ["https://example.invalid/{z}/{x}/{y}.pbf"] },
    },
    layers: [{ id: "water", type: "fill", source: "openmaptiles", "source-layer": "water" }],
  };
}

test("every URL on the tile host is pointed back at this server", () => {
  /*
   * The bypass this exists to stop: a style handed over unmodified fetches
   * itself through the forwarder and then goes STRAIGHT to the upstream for the
   * tiles, the glyphs behind every label and the sprite behind every icon — so
   * the map is blank on the machine that cannot reach the internet, which is
   * the machine the forwarder was built for.
   */
  const out = rewriteStyle(style());
  assert.equal(out.glyphs, `${VECTOR_PREFIX}/fonts/{fontstack}/{range}.pbf`);
  assert.equal(out.sprite, `${VECTOR_PREFIX}/sprites/ofm_f384`);
  assert.equal(out.sources.openmaptiles.url, `${VECTOR_PREFIX}/planet`);
  assert.deepEqual(out.sources.openmaptiles.tiles, [`${VECTOR_PREFIX}/planet/{z}/{x}/{y}.pbf`]);
  assert.equal(stillReachesOut(out), false);
});

test("it walks the whole object rather than naming the fields it knows", () => {
  // `sources` can hold a tiles array, a TileJSON url, or both; `sprite` is a
  // string in one version and a list of named sheets in another. Naming fields
  // means missing one the day the upstream style changes shape — and a missed
  // one is a silent request straight out of the browser.
  const odd = {
    sprite: [{ id: "default", url: `${VECTOR_HOST}/sprites/a` }],
    deeply: { nested: [{ thing: { url: `${VECTOR_HOST}/x/y.json` } }] },
  };
  const out = rewriteStyle(odd);
  assert.equal(out.sprite[0]?.url, `${VECTOR_PREFIX}/sprites/a`);
  assert.equal(out.deeply.nested[0]?.thing.url, `${VECTOR_PREFIX}/x/y.json`);
  assert.equal(stillReachesOut(out), false);
});

test("URLs that are not that host are left exactly alone", () => {
  const out = rewriteStyle(style());
  assert.deepEqual(out.sources.elsewhere.tiles, ["https://example.invalid/{z}/{x}/{y}.pbf"]);
  // A path that is already relative to this server must not be prefixed twice.
  assert.equal(rewriteStyle({ u: "/api/osm/vector/planet" }).u, "/api/osm/vector/planet");
  // Protocol-relative is a different host, not this one.
  assert.equal(rewriteStyle({ u: "//tiles.openfreemap.org/x" }).u, "//tiles.openfreemap.org/x");
});

test("the check is what catches a rewrite that missed something", () => {
  /*
   * It fails invisibly otherwise: the map looks perfect on the machine with
   * working internet and is blank on the one that needed the forwarder. So the
   * result is checked rather than trusted, and the nav view falls back to the
   * flat map when the check fails.
   */
  assert.equal(stillReachesOut({ sprite: `${VECTOR_HOST}/sprites/a` }), true);
  assert.equal(stillReachesOut(rewriteStyle(style())), false);
  assert.equal(stillReachesOut(null), false);
});

test("nothing else in the style is disturbed", () => {
  const out = rewriteStyle(style());
  assert.equal(out.version, 8);
  assert.deepEqual(out.layers, style().layers);
});

test("the style is fetched through this server, and the angle is sane", () => {
  assert.ok(VECTOR_STYLE.startsWith("/api/osm/"), VECTOR_STYLE);
  assert.ok(!VECTOR_STYLE.startsWith("//"), "a protocol-relative URL is a different host");
  // Past ~60° the horizon comes into frame and the far half of the screen is a
  // smear of two-pixel labels; under ~40° it is a flat map that happens to be
  // crooked.
  assert.ok(NAV_PITCH >= 40 && NAV_PITCH <= 60, `${NAV_PITCH}° is outside what reads as navigation`);
});
