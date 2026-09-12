import test from "node:test";
import assert from "node:assert/strict";

import { cacheKey, ResponseCache, type Cached } from "../src/lib/osm-cache.ts";

function reply(body: string, status = 200): Cached {
  return { status, contentType: "application/json", body: Buffer.from(body), at: Date.now() };
}

test("a stored reply comes back, and a request that was never made is one not made", () => {
  const cache = new ResponseCache(1024);
  const key = cacheKey("overpass", "POST", "/api/osm/overpass", "", Buffer.from("data=[out:json];"));
  assert.equal(cache.get(key, 60_000), null);

  cache.set(key, reply('{"elements":[]}'));
  const found = cache.get(key, 60_000);
  assert.ok(found);
  assert.equal(found.body.toString(), '{"elements":[]}');
  assert.equal(cache.stats().hits, 1);
});

test("the body is part of the key — two Overpass queries are two questions", () => {
  const a = cacheKey("overpass", "POST", "/api/osm/overpass", "", Buffer.from("data=way(1);"));
  const b = cacheKey("overpass", "POST", "/api/osm/overpass", "", Buffer.from("data=way(2);"));
  assert.notEqual(a, b);
  // And the same question is the same key, whoever is asking.
  assert.equal(a, cacheKey("overpass", "POST", "/api/osm/overpass", "", Buffer.from("data=way(1);")));
});

test("the query string is part of it too", () => {
  const a = cacheKey("nominatim", "GET", "/api/osm/nominatim/search", "?q=dam");
  const b = cacheKey("nominatim", "GET", "/api/osm/nominatim/search", "?q=centraal");
  assert.notEqual(a, b);
});

test("and the service is, so a path collision between two of them cannot happen", () => {
  assert.notEqual(
    cacheKey("osrm", "GET", "/x", "?a=1"),
    cacheKey("tile", "GET", "/x", "?a=1"),
  );
});

test("an entry past its lifetime is a miss, and is dropped", () => {
  const cache = new ResponseCache(1024);
  const key = cacheKey("overpass", "POST", "/p", "");
  cache.set(key, reply("{}"));

  const now = Date.now();
  assert.ok(cache.get(key, 60_000, now), "fresh");
  assert.equal(cache.get(key, 60_000, now + 60_001), null, "stale");
  assert.equal(cache.size, 0, "a stale entry is not left taking up room");
});

test("a zero lifetime never hits — that is how a service switches caching off", () => {
  const cache = new ResponseCache(1024);
  const key = cacheKey("osrm", "GET", "/p", "");
  cache.set(key, reply("{}"));
  assert.equal(cache.get(key, 0), null);
});

test("a rate limit is NEVER remembered", () => {
  // Caching a 429 for ten minutes turns one refusal into ten minutes of them,
  // and caching a 500 turns a blip into an outage.
  const cache = new ResponseCache(1024);
  for (const status of [429, 500, 502, 504, 403, 400]) {
    const key = cacheKey("overpass", "POST", `/p${status}`, "");
    cache.set(key, reply("no", status));
    assert.equal(cache.get(key, 60_000), null, `${status} was stored`);
  }
  assert.equal(cache.size, 0);
});

test("it stays inside its byte ceiling, dropping the least recently used", () => {
  const cache = new ResponseCache(300);
  const keys = ["a", "b", "c"].map((n) => cacheKey("tile", "GET", `/${n}`, ""));
  for (const key of keys) cache.set(key, reply("x".repeat(100)));
  assert.equal(cache.size, 3);
  assert.ok(cache.storedBytes <= 300);

  // Touch the oldest so it is no longer the least recently used...
  assert.ok(cache.get(keys[0] ?? "", 60_000));
  // ...then overflow by one.
  cache.set(cacheKey("tile", "GET", "/d", ""), reply("y".repeat(100)));

  assert.ok(cache.storedBytes <= 300, `held ${cache.storedBytes} bytes`);
  assert.ok(cache.get(keys[0] ?? "", 60_000), "the one just read must survive");
  assert.equal(cache.get(keys[1] ?? "", 60_000), null, "the least recently used goes first");
});

test("something bigger than the whole cache is simply not stored", () => {
  const cache = new ResponseCache(50);
  const key = cacheKey("tile", "GET", "/big", "");
  cache.set(key, reply("x".repeat(500)));
  assert.equal(cache.size, 0);
  assert.equal(cache.storedBytes, 0);
});

test("a cache of zero bytes stores nothing and does not divide by anything", () => {
  const cache = new ResponseCache(0);
  const key = cacheKey("tile", "GET", "/x", "");
  cache.set(key, reply("x"));
  assert.equal(cache.get(key, 60_000), null);
  assert.equal(cache.size, 0);
});

test("re-storing the same key does not double-count its bytes", () => {
  const cache = new ResponseCache(1000);
  const key = cacheKey("overpass", "POST", "/p", "");
  cache.set(key, reply("x".repeat(100)));
  cache.set(key, reply("y".repeat(100)));
  assert.equal(cache.size, 1);
  assert.equal(cache.storedBytes, 100);
});
