import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPrivateHost,
  matchesBypass,
  normaliseProxy,
  parseProxyPool,
  rankProxies,
  shouldProxy,
  type ProxyHealth,
} from "../src/lib/http/proxy.ts";
import { cooldownFor, parseRetryAfter, rest, cooldownRemaining, clearCooldowns, gate } from "../src/lib/http/limiter.ts";
import { isTransportFailure } from "../src/lib/http/fetch.ts";

test("a bare host:port is a proxy; http:// is assumed", () => {
  const entry = normaliseProxy("192.168.11.165:2000", 0);
  assert.ok(entry);
  assert.equal(entry.url, "http://192.168.11.165:2000");
  assert.equal(entry.kind, "http");
});

test("SOCKS is recognised and marked unsupported, not silently dropped", () => {
  const entry = normaliseProxy("socks5://85.234.100.149:1080", 3);
  assert.ok(entry);
  assert.equal(entry.kind, "unsupported");
  const { usable, rejected } = parseProxyPool(["192.168.11.165:2000", "socks5://85.234.100.149:1080"]);
  assert.equal(usable.length, 1);
  assert.equal(rejected.length, 1);
});

test("private addresses are never proxied — the local model lives there", () => {
  for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.11.165", "172.20.0.4", "box.local", "::1"]) {
    assert.equal(isPrivateHost(host), true, host);
    assert.equal(shouldProxy(host, []), false, host);
  }
  assert.equal(isPrivateHost("api.pdok.nl"), false);
  assert.equal(isPrivateHost("172.32.0.1"), false);
});

test("the bypass list is suffix matched, not substring matched", () => {
  assert.equal(matchesBypass("api.liara.ir", ["liara.ir"]), true);
  assert.equal(matchesBypass("liara.ir", ["liara.ir"]), true);
  assert.equal(matchesBypass("notliara.ir", ["liara.ir"]), false);
  assert.equal(shouldProxy("api.liara.ir", ["liara.ir", "liara.run"]), false);
  assert.equal(shouldProxy("api.pdok.nl", ["liara.ir"]), true);
});

test("the operator's own proxy outranks a faster borrowed one", () => {
  const pool = parseProxyPool(["192.168.11.165:2000", "176.111.37.5:39811"]).usable;
  const health: ProxyHealth[] = [
    { entry: pool[0]!, latencyMs: 600, restingUntil: 0, lastProbeAt: 0, lastError: null },
    { entry: pool[1]!, latencyMs: 40, restingUntil: 0, lastProbeAt: 0, lastError: null },
  ];
  const ranked = rankProxies(health, 0);
  assert.equal(ranked[0]!.entry.url, "http://192.168.11.165:2000");
});

test("latency decides within a tier, and resting proxies fall to the tail", () => {
  const pool = parseProxyPool(["192.168.11.165:2000", "176.111.37.5:39811", "8.219.97.248:80"]).usable;
  const now = 1_000;
  const health: ProxyHealth[] = [
    { entry: pool[0]!, latencyMs: 5, restingUntil: now + 5_000, lastProbeAt: 0, lastError: "refused" },
    { entry: pool[1]!, latencyMs: 900, restingUntil: 0, lastProbeAt: 0, lastError: null },
    { entry: pool[2]!, latencyMs: 300, restingUntil: 0, lastProbeAt: 0, lastError: null },
  ];
  const ranked = rankProxies(health, now);
  assert.deepEqual(
    ranked.map((item) => item.entry.url),
    ["http://8.219.97.248:80", "http://176.111.37.5:39811", "http://192.168.11.165:2000"],
  );
});

test("a rate limit and a timeout are different failures", () => {
  assert.equal(cooldownFor("rate-limit"), 120_000);
  assert.equal(cooldownFor("server-error"), 30_000);
  // Longest, because discovering a hung mirror costs the whole timeout and
  // everything queued behind it waited too.
  assert.equal(cooldownFor("timeout"), 180_000);
  assert.equal(cooldownFor("rate-limit", 300_000), 300_000);
});

test("Retry-After is honoured in both shapes", () => {
  assert.equal(parseRetryAfter("120"), 120_000);
  assert.equal(parseRetryAfter(null), 0);
  const at = new Date(Date.now() + 30_000).toUTCString();
  assert.ok(parseRetryAfter(at) > 25_000);
});

test("a cooldown is never shortened by a later, smaller rest", () => {
  clearCooldowns();
  rest("mirror-a", 180_000, 0);
  rest("mirror-a", 30_000, 0);
  assert.equal(cooldownRemaining("mirror-a", 0), 180_000);
  assert.equal(cooldownRemaining("mirror-a", 200_000), 0);
  clearCooldowns();
});

test("our own abort is not a transport failure", () => {
  const abort = new Error("The operation was aborted");
  abort.name = "AbortError";
  assert.equal(isTransportFailure(abort), false);

  const refused = new TypeError("fetch failed");
  refused.cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  assert.equal(isTransportFailure(refused), true);
});

test("the gate is process-wide and serialises to its limit", async () => {
  const serial = gate("test-serial", { maxConcurrent: 1, minIntervalMs: 0 });
  assert.equal(gate("test-serial", { maxConcurrent: 8, minIntervalMs: 0 }), serial);
  let peak = 0;
  let active = 0;
  await Promise.all(
    Array.from({ length: 5 }, () =>
      serial.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      }),
    ),
  );
  assert.equal(peak, 1);
});
