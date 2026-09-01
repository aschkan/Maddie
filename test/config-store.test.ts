import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resetConfig, getConfig, list, bool, num } from "../src/lib/config.ts";
import { absent, present, gapNote } from "../src/lib/signal.ts";
import { cacheClear, cacheGet, cacheSet, cached } from "../src/lib/cache.ts";
import { getStore } from "../src/lib/store/index.ts";

test("the app is fully configured by an EMPTY environment", () => {
  const config = loadConfig({});
  assert.equal(config.region, "NL");
  assert.equal(config.crimeTable, "47022NED");
  assert.equal(config.crimeEnabled, true);
  assert.equal(config.mapStyleUrl, "/api/map/styles/liberty");
  assert.equal(config.googleMapsKey, "");
  assert.equal(config.mapillaryToken, "");
  // ADMIN_TOKEN unset means OFF, never open.
  assert.equal(config.adminToken, "");
  assert.equal(config.proxyPool.length, 0);
  assert.equal(config.aiUseProxy, false, "the AI tier defaults to no proxy");
  assert.equal(config.overpassMaxConcurrent, 1);
});

test("the local AI URL is derived from the host, and 'off' disables the tier", () => {
  assert.equal(loadConfig({ LOCAL_AI_HOST: "192.168.11.165" }).localAiUrl, "http://192.168.11.165:1234/v1");
  assert.equal(loadConfig({ LOCAL_AI_HOST: "192.168.11.165", LOCAL_AI_URL: "off" }).localAiUrl, "");
  assert.equal(loadConfig({ LOCAL_AI_URL: "http://box:1234/v1/" }).localAiUrl, "http://box:1234/v1");
  assert.equal(loadConfig({}).localAiUrl, "");
});

test("a malformed AI_TASK_MODELS does not take the AI tier down with it", () => {
  assert.deepEqual(loadConfig({ AI_TASK_MODELS: "not json" }).aiTaskModels, {});
  assert.deepEqual(loadConfig({ AI_TASK_MODELS: '{"local:infer-segment":"qwen"}' }).aiTaskModels, {
    "local:infer-segment": "qwen",
  });
});

test("the proxy pool keeps the operator's order", () => {
  const config = loadConfig({ UPSTREAM_PROXY_URL: "192.168.11.165:2000, 176.111.37.5:39811 ,," });
  assert.deepEqual(config.proxyPool, ["192.168.11.165:2000", "176.111.37.5:39811"]);
  assert.deepEqual(list({ X: " a , b ; c " }, "X"), ["a", "b", "c"]);
  assert.equal(bool({ X: "yes" }, "X", false), true);
  assert.equal(bool({ X: "nonsense" }, "X", true), true);
  assert.equal(num({ X: "nonsense" }, "X", 7), 7);
});

test("the crime window is clamped rather than trusted", () => {
  assert.equal(loadConfig({ NL_CRIME_WINDOW_MONTHS: "0" }).crimeWindowMonths, 1);
  assert.equal(loadConfig({ NL_CRIME_WINDOW_MONTHS: "9999" }).crimeWindowMonths, 60);
});

test("gap notes always attribute the gap to us, not to the place", () => {
  for (const reason of ["not-configured", "unreachable", "no-coverage", "out-of-region", "not-published"] as const) {
    const note = gapNote("The police crime figures", reason);
    assert.match(note, /gap in the data, not a statement about the place/);
  }
  const missing = absent("unreachable", "CBS", gapNote("The police crime figures", "unreachable"));
  assert.equal(missing.available, false);
  const found = present({ total: 0 }, "CBS", 1.4);
  assert.equal(found.available, true);
  assert.equal(found.confidence, 1, "confidence is clamped to 0..1");
});

test("a failed lap is never what gets cached", async () => {
  cacheClear();
  let calls = 0;
  const produce = async (): Promise<string> => {
    calls += 1;
    if (calls === 1) throw new Error("transient");
    return "value";
  };
  await assert.rejects(() => cached("k", 60_000, produce));
  assert.equal(cacheGet("k"), undefined, "the failure must not be stored");
  assert.equal(await cached("k", 60_000, produce), "value");
  assert.equal(await cached("k", 60_000, produce), "value");
  assert.equal(calls, 2, "the second call was served from the cache");
  cacheClear();
});

test("cache entries expire", () => {
  cacheClear();
  cacheSet("k", 1, 1_000, 0);
  assert.equal(cacheGet("k", 500), 1);
  assert.equal(cacheGet("k", 2_000), undefined);
  cacheClear();
});

test("the file store survives without Redis, and keeps lists and counters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maddie-store-"));
  const previous = { dir: process.env.MADDIE_DATA_DIR, url: process.env.UPSTASH_REDIS_REST_URL };
  process.env.MADDIE_DATA_DIR = directory;
  delete process.env.UPSTASH_REDIS_REST_URL;
  resetConfig();
  delete (globalThis as Record<string, unknown>).__maddie_store__;

  try {
    assert.equal(getConfig().dataDir, directory);
    const store = getStore();
    assert.equal(store.backend, "file");

    await store.set("a", { hello: "world" });
    assert.deepEqual(await store.get("a"), { hello: "world" });

    await store.append("list", { id: 1 });
    await store.append("list", { id: 2 });
    assert.deepEqual(await store.list("list"), [{ id: 1 }, { id: 2 }]);

    assert.equal(await store.increment("counter", 3_600), 1);
    assert.equal(await store.increment("counter", 3_600), 2);

    await store.set("ttl", "gone", 0.001);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await store.get("ttl"), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (previous.dir === undefined) delete process.env.MADDIE_DATA_DIR;
    else process.env.MADDIE_DATA_DIR = previous.dir;
    if (previous.url !== undefined) process.env.UPSTASH_REDIS_REST_URL = previous.url;
    resetConfig();
    delete (globalThis as Record<string, unknown>).__maddie_store__;
  }
});
