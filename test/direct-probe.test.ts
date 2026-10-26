import test from "node:test";
import assert from "node:assert/strict";

import { DIRECT_PROBE_URLS, PROBE_URL, ProxyPool } from "../src/lib/proxy-pool.ts";

/*
 * "Can this server get out" gates every service, so it must never hang on one
 * upstream: an overloaded overpass-api.de once read as "no internet" on both
 * boxes and failed every tile on the site.
 */

test("the direct probe asks Overpass AND the tile server, not Overpass alone", () => {
  assert.ok(DIRECT_PROBE_URLS.includes(PROBE_URL));
  assert.ok(DIRECT_PROBE_URLS.some((url) => new URL(url).host === "tile.openstreetmap.org"));
});

test("when every probe fails, direct is off and the reason names each one", async () => {
  const proxies = new ProxyPool();
  // Port 1 on loopback refuses at once: nothing leaves the machine.
  proxies.directProbeUrls = ["https://127.0.0.1:1/a", "https://127.0.0.1:1/b"];
  assert.equal(await proxies.checkDirect(), false);
  assert.equal(proxies.directWorks, false);
  assert.equal(proxies.directState.lastError?.split("; ").length, 2);
});
