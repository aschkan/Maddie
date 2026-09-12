import test from "node:test";
import assert from "node:assert/strict";

import net from "node:net";

import { cooldownMs, ProxyPool, rank, type HopState } from "../src/lib/proxy-pool.ts";
import { SERVICES, shouldRotate, upstreamUrl } from "../src/lib/osm-forward.ts";

function state(label: string, over: Partial<HopState> = {}): HopState {
  const [host = label, port = "8080"] = label.split(":");
  return {
    hop: { host, port: Number(port), label },
    ok: null, latencyMs: null, lastProbe: 0, lastError: null,
    failures: 0, restingUntil: 0, inFlight: false, successes: 0,
    ...over,
  };
}

const NOW = 1_800_000_000_000;

/* -------------------------------- ranking --------------------------------- */

test("working proxies come first, fastest first", () => {
  const ranked = rank([
    state("slow:1", { ok: true, latencyMs: 3000 }),
    state("dead:2", { ok: false }),
    state("fast:3", { ok: true, latencyMs: 400 }),
  ], NOW);
  assert.deepEqual(ranked.map((s) => s.hop.label), ["fast:3", "slow:1", "dead:2"]);
});

test("never-probed comes after working but before known-dead", () => {
  // This is what makes a cold start usable: the first request does not wait
  // for a sweep of 649 proxies, it just tries the unproven ones next.
  const ranked = rank([
    state("dead:1", { ok: false }),
    state("new:2"),
    state("good:3", { ok: true, latencyMs: 900 }),
  ], NOW);
  assert.deepEqual(ranked.map((s) => s.hop.label), ["good:3", "new:2", "dead:1"]);
});

test("a resting proxy is not offered at all until its cooldown expires", () => {
  const resting = state("resting:1", { ok: true, latencyMs: 10, restingUntil: NOW + 1000 });
  const plain = state("plain:2", { ok: true, latencyMs: 5000 });
  assert.deepEqual(rank([resting, plain], NOW).map((s) => s.hop.label), ["plain:2"]);
  // …and is back once it has.
  assert.equal(rank([resting, plain], NOW + 2000).length, 2);
});

test("a proxy already carrying a request is skipped", () => {
  // Two requests at once should leave through two different exits — which is
  // also what stops both of them landing on one mirror's rate limit.
  const busy = state("busy:1", { ok: true, latencyMs: 10, inFlight: true });
  const free = state("free:2", { ok: true, latencyMs: 900 });
  assert.deepEqual(rank([busy, free], NOW).map((s) => s.hop.label), ["free:2"]);
});

test("ranking is stable when everything else is equal", () => {
  // Otherwise the order shuffles between requests and a failure is impossible
  // to reproduce.
  const states = [state("b:1", { ok: true, latencyMs: 100 }), state("a:2", { ok: true, latencyMs: 100 })];
  assert.deepEqual(rank(states, NOW).map((s) => s.hop.label), ["a:2", "b:1"]);
});

test("nothing available is an empty list, not a crash", () => {
  assert.deepEqual(rank([], NOW), []);
  assert.deepEqual(rank([state("x:1", { restingUntil: NOW + 1 })], NOW), []);
});

/* -------------------------------- cooldown -------------------------------- */

test("the cooldown grows with consecutive failures, and stops growing", () => {
  // Retrying dead entries is the single biggest cost here: 649 of them at a
  // 20-second timeout each will eat any request budget there is.
  assert.equal(cooldownMs(1), 30_000);
  assert.ok(cooldownMs(2) > cooldownMs(1));
  assert.ok(cooldownMs(4) > cooldownMs(3));
  assert.equal(cooldownMs(9), cooldownMs(5), "it stops at the top of the ladder");
  assert.equal(cooldownMs(0), 30_000, "and never returns undefined");
});

/* ------------------------------- forwarding -------------------------------- */

test("only the services in the table can be reached", () => {
  assert.deepEqual(Object.keys(SERVICES).sort(), ["nominatim", "osrm", "overpass", "tile"]);
  for (const service of Object.values(SERVICES)) {
    assert.ok(service.bases.length > 0);
    for (const base of service.bases) assert.match(base, /^https?:\/\//);
  }
});

test("the path is appended to the service's own base, and nothing else", () => {
  const osrm = SERVICES.osrm;
  assert.ok(osrm);
  const url = upstreamUrl(osrm, ["route", "v1", "foot", "4.89,52.37;4.90,52.38"], "?overview=full");
  assert.ok(url?.startsWith("https://router.project-osrm.org/route/v1/foot/"), url ?? "");
  assert.ok(url?.endsWith("?overview=full"));
});

test("a path that tries to climb out of the base is refused", () => {
  // Without this the route is an open proxy for the rest of the upstream host,
  // and an open proxy on a public server is somebody's problem within the day.
  const osrm = SERVICES.osrm;
  assert.ok(osrm);
  assert.equal(upstreamUrl(osrm, ["..", "admin"], ""), null);
  assert.equal(upstreamUrl(osrm, ["."], ""), null);
  assert.equal(upstreamUrl(osrm, ["a//b"], ""), null);
  assert.equal(upstreamUrl(osrm, ["a\\b"], ""), null);
});

test("a path segment cannot smuggle in another host", () => {
  const tile = SERVICES.tile;
  assert.ok(tile);
  const url = upstreamUrl(tile, ["evil.example.com", "1", "2.png"], "");
  assert.ok(url?.startsWith("https://tile.openstreetmap.org/"), url ?? "");
});

test("Overpass ignores the path entirely — the client posts to the base", () => {
  const overpass = SERVICES.overpass;
  assert.ok(overpass);
  assert.equal(upstreamUrl(overpass, ["anything", "at", "all"], ""), overpass.bases[0]);
});

test("each retry moves to the next mirror, and wraps", () => {
  // A rate limit is per exit IP PER HOST, so changing both on a retry is two
  // independent chances rather than one.
  const overpass = SERVICES.overpass;
  assert.ok(overpass);
  assert.ok(overpass.bases.length > 1, "Overpass should have mirrors to rotate through");
  assert.equal(upstreamUrl(overpass, [], "", 1), overpass.bases[1]);
  assert.equal(upstreamUrl(overpass, [], "", overpass.bases.length), overpass.bases[0]);
});

test("rate limits and gateway failures rotate; a bad query does not", () => {
  for (const status of [429, 403, 408, 500, 502, 503, 504]) {
    assert.equal(shouldRotate(status), true, String(status));
  }
  // 400 means the query is wrong. Asking every proxy in turn the same wrong
  // question burns a slot on each of them and still gets a 400.
  for (const status of [200, 204, 304, 400, 404]) {
    assert.equal(shouldRotate(status), false, String(status));
  }
});

/* ------------------------- whose fault was it -------------------------- */

test("an upstream saying no does not retire the proxy that carried it", async () => {
  // The bug this exists for: a 403 from OpenStreetMap marked every exit dead,
  // so one unreachable destination emptied the entire pool and the next
  // request had nothing left to try.
  const { ProxyPool } = await import("../src/lib/proxy-pool.ts");
  const proxies = new ProxyPool();
  proxies.states = [
    state("a:1", { ok: true, latencyMs: 10 }),
    state("b:2", { ok: true, latencyMs: 20 }),
  ];

  const result = await proxies.rotate(async () =>
    ({ done: false as const, reason: "upstream answered 403", fault: "upstream" as const }));

  assert.equal(result.ok, false);
  for (const s of proxies.states) {
    assert.equal(s.ok, true, `${s.hop.label} should still be considered good`);
    assert.equal(s.restingUntil, 0, `${s.hop.label} should not be resting`);
    assert.equal(s.failures, 0);
  }
});

test("a dead tunnel does count against the proxy", async () => {
  const { ProxyPool } = await import("../src/lib/proxy-pool.ts");
  const proxies = new ProxyPool();
  proxies.states = [state("a:1", { ok: true, latencyMs: 10 })];

  await proxies.rotate(async () => { throw new Error("CONNECT a:1 refused with 403"); });

  const only = proxies.states[0];
  assert.equal(only?.ok, false);
  assert.equal(only?.failures, 1);
  assert.ok((only?.restingUntil ?? 0) > Date.now());
});

test("a rate limit steps the exit aside without holding it against it", async () => {
  const { ProxyPool, LIMIT_REST_MS } = await import("../src/lib/proxy-pool.ts");
  const proxies = new ProxyPool();
  proxies.states = [state("a:1", { ok: true, latencyMs: 10 })];

  await proxies.rotate(async () =>
    ({ done: false as const, reason: "upstream answered 429", fault: "limit" as const }));

  const only = proxies.states[0];
  assert.equal(only?.ok, true, "the proxy did its job");
  assert.equal(only?.failures, 0, "and must not climb the cooldown ladder for it");
  assert.ok((only?.restingUntil ?? 0) <= Date.now() + LIMIT_REST_MS);
  assert.ok((only?.restingUntil ?? 0) > Date.now());
});

test("one request never tries the same exit twice", async () => {
  // Rotation is only worth anything if it actually moves. Without this the
  // best-ranked hop is picked again and again for the same request.
  const { ProxyPool } = await import("../src/lib/proxy-pool.ts");
  const proxies = new ProxyPool();
  proxies.maxAttempts = 3;
  proxies.states = [
    state("a:1", { ok: true, latencyMs: 10 }),
    state("b:2", { ok: true, latencyMs: 20 }),
    state("c:3", { ok: true, latencyMs: 30 }),
  ];

  const seen: string[] = [];
  const result = await proxies.rotate(async (s) => {
    seen.push(s.hop.label);
    return { done: false as const, reason: "upstream answered 500", fault: "upstream" as const };
  });

  assert.deepEqual(seen, ["a:1", "b:2", "c:3"]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.tried, ["a:1", "b:2", "c:3"]);
});

test("rotation stops at the attempt limit rather than walking the whole list", async () => {
  const { ProxyPool } = await import("../src/lib/proxy-pool.ts");
  const proxies = new ProxyPool();
  proxies.maxAttempts = 2;
  proxies.states = Array.from({ length: 20 }, (_, i) =>
    state(`h${String(i).padStart(2, "0")}:1`, { ok: true, latencyMs: i }));

  let calls = 0;
  await proxies.rotate(async () => {
    calls += 1;
    return { done: false as const, reason: "nope", fault: "upstream" as const };
  });
  assert.equal(calls, 2);
});

test("the first exit that answers is the one used, and it is named", async () => {
  const { ProxyPool } = await import("../src/lib/proxy-pool.ts");
  const proxies = new ProxyPool();
  proxies.states = [state("slow:1", { ok: true, latencyMs: 900 }), state("fast:2", { ok: true, latencyMs: 20 })];

  const result = await proxies.rotate(async (s) =>
    s.hop.label === "fast:2"
      ? { done: false as const, reason: "upstream answered 502", fault: "upstream" as const }
      : { done: true as const, value: "body" });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value, "body");
    assert.equal(result.via, "slow:1");
    assert.equal(result.attempts, 2);
  }
});

/* ─────────────────── the entry proxy, and who gets blamed ────────────────── */

test("an entry that cannot be reached is not the exit's fault", async () => {
  // The bug this pins, from a real status page: every one of 649 hops failed
  // with "no TCP connection to 192.168.11.165:2000", all 649 were marked dead
  // and 536 were left resting — for a fault none of them had, through a LAN
  // proxy none of them was ever reached through. The list then reported
  // `working: 0` about proxies it had never tried.
  const pool = new ProxyPool();
  pool.entry = { host: "192.168.11.165", port: 2000, label: "192.168.11.165:2000" };
  pool.states = [state("1.1.1.1:8080")];
  // An unreachable LAN address would otherwise burn the nine-second default.
  pool.probeTimeoutMs = 400;
  pool.entryTimeoutMs = 400;

  const exit = pool.states[0];
  assert.ok(exit);
  await pool.probe(exit);

  // Nothing was learned about the exit, so nothing may be held against it.
  assert.notEqual(exit.ok, false, "the exit was blamed for the entry");
  assert.equal(exit.restingUntil, 0, "the exit was rested for the entry");
  assert.equal(exit.failures, 0);

  // And what WAS learned is recorded against the thing that failed.
  assert.equal(pool.entryState.ok, false);
  assert.match(pool.entryState.lastError ?? "", /192\.168\.11\.165:2000/);
});

test("and the entry is reported as the thing that is down", async () => {
  const pool = new ProxyPool();
  pool.entry = { host: "192.168.11.165", port: 2000, label: "192.168.11.165:2000" };
  pool.states = [state("1.1.1.1:8080")];
  pool.entryTimeoutMs = 400;

  await pool.checkEntry();
  assert.equal(pool.entryState.ok, false);

  const said = pool.problem();
  assert.ok(said, "a dead entry is a problem worth one sentence");
  assert.match(said, /192\.168\.11\.165:2000/);
  assert.match(said, /cannot be reached from this server/i);
  // And it says what happens next, because "working: 0" did not.
  assert.match(said, /tried directly instead/i);

  const summary = pool.summary();
  assert.equal(summary.entryOk, false);
  assert.equal(summary.bypassingEntry, true);
  assert.equal(summary.problem, said);
});

test("with the entry down, the provided list is used DIRECTLY", async () => {
  // The whole point. An entry that is the only way out is an assumption, and
  // enforcing it against a dead entry turns 649 proxies into none.
  const pool = new ProxyPool();
  pool.entry = { host: "192.168.11.165", port: 2000, label: "192.168.11.165:2000" };
  pool.states = [state("1.1.1.1:8080")];

  assert.equal(pool.entryFor()?.label, "192.168.11.165:2000", "used while it is believed up");

  pool.entryState = { ok: false, lastError: "no TCP connection", lastCheck: Date.now(), latencyMs: null };
  assert.equal(pool.entryFor(), null, "and stepped over once it is known down");
  assert.equal(pool.bypassingEntry, true);
});

test("a live entry is used, and is not reported as a problem", async () => {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as net.AddressInfo).port;

  const pool = new ProxyPool();
  pool.entry = { host: "127.0.0.1", port, label: `127.0.0.1:${port}` };
  pool.states = [state("1.1.1.1:8080")];
  try {
    assert.equal(await pool.checkEntry(), true);
    assert.equal(pool.entryState.ok, true);
    assert.equal(pool.bypassingEntry, false);
    assert.equal(pool.entryFor()?.port, port);
    assert.equal(pool.problem(), null);
  } finally {
    server.close();
  }
});

test("one request stops spending time once its budget is gone", async () => {
  const pool = new ProxyPool();
  pool.states = [state("1.1.1.1:8080"), state("2.2.2.2:8080"), state("3.3.3.3:8080")];
  pool.maxAttempts = 3;
  pool.budgetMs = 0;   // already spent

  const result = await pool.rotate(async () => ({ done: true as const, value: "never" }));
  assert.ok(!result.ok);
  assert.equal(result.tried.length, 0, "a spent budget tries nothing further");
  assert.match(result.reasons.join(" "), /gave up after/);
});
