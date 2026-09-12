import test from "node:test";
import assert from "node:assert/strict";

import {
  CHUNK_MIN_M, MAX_CHUNKS, chunkPath, computeFacts, exitsAvailable, fetchFacts, forgetExits,
  overpassQuery, piecesFor, piecesForRoute, PIECE_ROUNDS,
} from "../src/lib/overpass.ts";
import { pathLengthM } from "../src/lib/geo.ts";
import type { LatLng } from "../src/lib/osrm.ts";

/**
 * A straight line east from Dam square, `metres` long.
 *
 * Built from many vertices rather than two, because `chunkPath` cuts at
 * vertices — a two-point route has nowhere to cut and would prove nothing.
 */
function line(metres: number, vertices = 60): LatLng[] {
  const lat = 52.3731;
  // At this latitude a degree of longitude is about 68 km.
  const perDegree = 111_320 * Math.cos((lat * Math.PI) / 180);
  const span = metres / perDegree;
  return Array.from({ length: vertices }, (_, i) => ({
    lat,
    lng: 4.8926 + (span * i) / (vertices - 1),
  }));
}

/* --------------------------------- cutting --------------------------------- */

test("a short route is not cut at all", () => {
  // Four queries to answer what one query answers as fast is four slots spent
  // for nothing. The split earns its keep on the long routes.
  const short = line(CHUNK_MIN_M - 200);
  assert.equal(chunkPath(short).length, 1);
});

test("a long route is cut, and never past the ceiling", () => {
  assert.equal(chunkPath(line(400_000)).length, MAX_CHUNKS);
});

test("a LONGER route is cut into MORE pieces, which is the point", () => {
  // The reason the ceiling was raised from four. A long walk is exactly the
  // case that wants spreading; capping it low means a handful of enormous
  // queries, each nearer Overpass's own timeout and nearer the `out ... 2000`
  // truncation, while a healthy pool sits idle.
  const plenty = 40;
  const short = piecesForRoute(5_000, plenty);
  const medium = piecesForRoute(15_000, plenty);
  const long = piecesForRoute(40_000, plenty);
  assert.ok(short < medium && medium < long, `${short}, ${medium}, ${long} should increase`);
  assert.equal(long, MAX_CHUNKS);
});

test("a long route on a starved pool asks for what the pool can carry", () => {
  // The failure this all started from, as a rule: length says how many pieces
  // the route warrants, the pool says how many can be in the air at once. The
  // smaller wins, because one piece that cannot be read fails the whole read.
  assert.equal(piecesForRoute(40_000, 4), piecesFor(4));
  assert.equal(piecesForRoute(40_000, 4), 2);
});

test("the pieces cover the whole route, with no gap between them", () => {
  // A gap is the failure that matters and it is invisible: an unqueried notch
  // has no ways under it, so every sample there reads as "no lighting
  // information" and the map draws it grey — a claim about OpenStreetMap that
  // would be false.
  const path = line(12_000);
  const chunks = chunkPath(path);
  assert.ok(chunks.length > 1, "this route should have been cut");

  for (let i = 1; i < chunks.length; i++) {
    const previous = chunks[i - 1];
    const here = chunks[i];
    assert.ok(previous && here);
    const last = previous[previous.length - 1];
    const first = here[0];
    // The boundary vertex belongs to BOTH neighbours, so the corridors join.
    assert.deepEqual(first, last, `piece ${i} does not start where piece ${i - 1} ended`);
  }

  // And nothing was dropped in the middle: the pieces re-assemble into the
  // original, each shared vertex counted once.
  const rebuilt = chunks.flatMap((chunk, index) => (index === 0 ? chunk : chunk.slice(1)));
  assert.deepEqual(rebuilt, path);
});

test("every piece is long enough to be a query at all", () => {
  // `overpassQuery` needs two points to describe a corridor and returns null
  // below that — a piece that cannot be asked about is a hole in the read.
  for (const metres of [3_000, 7_500, 20_000, 100_000]) {
    for (const chunk of chunkPath(line(metres))) {
      assert.ok(chunk.length >= 2, `${metres} m produced a ${chunk.length}-point piece`);
      assert.ok(overpassQuery(chunk) !== null, `${metres} m produced an unaskable piece`);
    }
  }
});

test("the pieces are roughly equal, so no one exit carries the whole route", () => {
  const path = line(20_000);
  const lengths = chunkPath(path).map(pathLengthM);
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);
  assert.ok(longest / shortest < 1.6, `pieces were ${lengths.map(Math.round).join(", ")}`);
});

test("a route with nothing in it is no pieces, not one empty one", () => {
  assert.deepEqual(chunkPath([]), []);
  assert.deepEqual(chunkPath([{ lat: 52.37, lng: 4.89 }]), []);
});

/* -------------------------------- fetching --------------------------------- */

/** A reply carrying one lamp, at the given point. */
function lamp(id: number, point: LatLng): unknown {
  return { type: "node", id, lat: point.lat, lon: point.lng, tags: { highway: "street_lamp" } };
}

function jsonReply(elements: unknown[]): Response {
  return new Response(JSON.stringify({ elements }), {
    headers: { "content-type": "application/json" },
  });
}

test("the pieces go out AT ONCE, not one after another", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });

  let live = 0;
  let mostAtOnce = 0;
  globalThis.fetch = (async () => {
    live += 1;
    mostAtOnce = Math.max(mostAtOnce, live);
    await new Promise((resolve) => setTimeout(resolve, 10));
    live -= 1;
    return jsonReply([]);
  }) as typeof fetch;

  const path = line(20_000);
  const expected = piecesForRoute(pathLengthM(path), exitsAvailable());
  assert.ok(expected > 1, "this route should have been split");
  await fetchFacts(path, { base: "http://example.invalid/overpass" });
  // Serial would peak at one. Parallel is the whole point: the read takes as
  // long as the slowest piece rather than the sum of them.
  assert.equal(mostAtOnce, expected);
});

test("what the pieces bring back is merged, and counted once", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });

  const path = line(20_000);
  const here = path[10];
  const there = path[40];
  assert.ok(here && there);

  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    // Two pieces both return the SAME lamp — which is what really happens
    // around the vertex two corridors share.
    if (call === 1) return jsonReply([lamp(1, here), lamp(2, there)]);
    if (call === 2) return jsonReply([lamp(1, here)]);
    return jsonReply([]);
  }) as typeof fetch;

  const result = await fetchFacts(path, { base: "http://example.invalid/overpass" });
  assert.ok(result.ok);
  // Two distinct lamps, not three. Counting one twice because the route
  // happened to be cut beside it would make the score depend on where the cut
  // fell, which is an implementation detail.
  assert.equal(result.facts.lamps, 2);
});

test("a split read counts the same as an unsplit one", async (t) => {
  // The guarantee that makes the split safe: `readRoute` still runs once over
  // the whole path, so the answer does not depend on how many pieces it took.
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });

  const path = line(20_000);
  const elements = [10, 20, 30, 40].map((index, n) => {
    const point = path[index];
    assert.ok(point);
    return lamp(n + 1, point);
  });

  globalThis.fetch = (async () => jsonReply(elements)) as typeof fetch;
  const split = await fetchFacts(path, { base: "http://example.invalid/overpass" });
  assert.ok(split.ok);

  const whole = computeFacts(path, elements as never[]);
  assert.deepEqual(split.facts, whole);
});

test("a rate limit is reported as one, and outranks any other failure", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });

  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    // One piece is refused for the limit and another fails outright. The limit
    // is the one with an action attached — wait a minute — and reporting the
    // neighbour's 500 instead would send the reader to check a healthy server.
    if (call === 1) return new Response("", { status: 500 });
    if (call === 2) {
      return new Response(JSON.stringify({ error: "limited", exitsTried: 4 }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    return jsonReply([]);
  }) as typeof fetch;

  const result = await fetchFacts(line(20_000), { base: "http://example.invalid/overpass" });
  assert.ok(!result.ok);
  assert.match(result.error, /rate limit/i);
  // The server said how many exits it spent, so the sentence says so too:
  // "we are being rate limited" is a guess, "we tried four exits and each was
  // refused" is an explanation.
  assert.match(result.error, /4 different exits/);
});

test("a piece that never comes back fails the whole read, after several tries", async (t) => {
  /*
   * The correctness rule, and it survives the retries.
   *
   * Counting what came back would leave the unfetched stretch with no ways
   * under it — every sample there reads "no lighting information", the map
   * draws it grey with "nobody has mapped this", and that is a claim about
   * OpenStreetMap which would be false. So the read declines rather than
   * answering for six sevenths of a walk and being silently wrong about the
   * seventh.
   */
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; forgetExits(); });
  forgetExits();

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("", { status: 500 });
  }) as typeof fetch;

  const path = line(20_000);
  const pieces = piecesForRoute(pathLengthM(path), exitsAvailable());
  const result = await fetchFacts(path, { base: "http://example.invalid/overpass" });

  assert.ok(!result.ok);
  assert.match(result.error, /answered 500/);
  assert.match(result.error, new RegExp(`one of ${pieces} parts`));
  assert.match(result.error, new RegExp(`after ${PIECE_ROUNDS} tries`));
  // Every piece, every round — and no more than that.
  assert.equal(calls, pieces * PIECE_ROUNDS);
});

test("a cancelled read says so, and says nothing else", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () => {
    throw new DOMException("aborted", "AbortError");
  }) as typeof fetch;

  const result = await fetchFacts(line(20_000), { base: "http://example.invalid/overpass" });
  assert.ok(!result.ok);
  assert.equal(result.error, "cancelled");
});

/* ------------- the split needs somewhere for each piece to go ------------- */

test("there are enough Overpass mirrors for everything that leaves from one IP", async () => {
  /*
   * The invariant that broke, narrowed to what it really is.
   *
   * Pieces that go out through PROXIES each have their own IP, so they may
   * share a mirror freely — the limit is per IP per host. The ones that go out
   * DIRECTLY all leave from this server's single address, and only landing on
   * different hosts keeps them apart. `DIRECT_CONCURRENCY` is how many of those
   * there can be at once, so that — not `MAX_CHUNKS` — is what the mirror list
   * has to cover.
   */
  const { SERVICES } = await import("../src/lib/osm-forward.ts");
  const { DIRECT_CONCURRENCY } = await import("../src/lib/proxy-pool.ts");
  const overpass = SERVICES.overpass;
  assert.ok(overpass);
  assert.ok(
    overpass.bases.length >= DIRECT_CONCURRENCY,
    `${DIRECT_CONCURRENCY} direct at once but only ${overpass.bases.length} mirrors`,
  );
});

test("only so many requests may go out directly at once", async () => {
  /*
   * Direct is ONE exit — this server's own IP — however big the pool is, and
   * the forwarder reaches for it first whenever it works. Untracked, every
   * piece of a parallel read took it and they all left from the same address,
   * which is the per-IP limit the split exists to get under.
   */
  const { ProxyPool, DIRECT_CONCURRENCY } = await import("../src/lib/proxy-pool.ts");
  const proxies = new ProxyPool();
  proxies.directState = { ok: true, lastError: null, lastCheck: Date.now(), latencyMs: 10 };

  const taken = Array.from({ length: DIRECT_CONCURRENCY + 3 }, () => proxies.takeDirect());
  assert.equal(taken.filter(Boolean).length, DIRECT_CONCURRENCY);

  // And it is given back, or the lane closes for the life of the process.
  for (let i = 0; i < DIRECT_CONCURRENCY; i++) proxies.releaseDirect();
  assert.equal(proxies.takeDirect(), true);
});

test("a server that cannot go out directly never claims the direct lane", async () => {
  const { ProxyPool } = await import("../src/lib/proxy-pool.ts");
  const proxies = new ProxyPool();
  // `directState` starts unprobed, which counts as "no": the blocked machine
  // must not pay a timeout per request rediscovering that it is blocked.
  assert.equal(proxies.takeDirect(), false);
});

test("concurrent requests are handed different mirrors", async () => {
  const { ProxyPool } = await import("../src/lib/proxy-pool.ts");
  const { SERVICES, upstreamUrl } = await import("../src/lib/osm-forward.ts");
  const overpass = SERVICES.overpass;
  assert.ok(overpass);

  const proxies = new ProxyPool();
  // One turn around the list must visit every mirror exactly once.
  const hosts = Array.from({ length: overpass.bases.length }, () =>
    upstreamUrl(overpass, [], "", proxies.mirrorTurn()),
  );
  assert.equal(new Set(hosts).size, overpass.bases.length, `mirrors repeated: ${hosts.join(", ")}`);
});

/* ----------- never ask for more pieces than the server can carry ---------- */

test("the split shrinks to what the server says it can carry", async (t) => {
  /*
   * The failure this fixes, from a real status page: 4 working exits, 19
   * resting after rate limits, and a route read asking for 4 pieces at once.
   * The last piece found nothing available, `rotate()` returned having tried
   * nothing, and the whole read failed with "no route out worked" while the
   * other three came back fine.
   */
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; forgetExits(); });
  forgetExits();

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ elements: [] }), {
      headers: { "content-type": "application/json", "x-osm-exits": "2" },
    });
  }) as typeof fetch;

  const path = line(20_000);

  // The first read has nothing to go on and uses the optimistic default.
  const optimistic = piecesForRoute(pathLengthM(path), exitsAvailable());
  assert.ok(optimistic > 1);
  await fetchFacts(path, { base: "http://example.invalid/overpass" });
  assert.equal(calls, optimistic);
  assert.equal(exitsAvailable(), 2, "the reply said how many exits there are");

  // The second sizes itself to what the server just reported — one piece per
  // two exits, so every piece still has somewhere to rotate to.
  calls = 0;
  await fetchFacts(path, { base: "http://example.invalid/overpass" });
  assert.equal(calls, piecesFor(2), "asked for more pieces than the pool can carry");
  assert.equal(calls, 1);
});

test("a server with one way out is read in one piece, not failed", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; forgetExits(); });
  forgetExits();

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ elements: [] }), {
      headers: { "content-type": "application/json", "x-osm-exits": "0" },
    });
  }) as typeof fetch;

  const path = line(20_000);
  await fetchFacts(path, { base: "http://example.invalid/overpass" });

  calls = 0;
  const result = await fetchFacts(path, { base: "http://example.invalid/overpass" });
  // Zero exits is a real answer, but a zero-piece split is not a smaller
  // request — it is no request at all, and the read must still be attempted.
  assert.equal(calls, 1);
  assert.ok(result.ok);
});

test("an error reply teaches the client too — that is when it matters most", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; forgetExits(); });
  forgetExits();

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "limited", exitsTried: 0 }), {
      status: 429,
      headers: { "content-type": "application/json", "x-osm-exits": "1" },
    })) as typeof fetch;

  const result = await fetchFacts(line(20_000), { base: "http://example.invalid/overpass" });
  assert.ok(!result.ok);
  assert.match(result.error, /rate limit/i);
  // The pool was down to one exit when it refused us; the next read must not
  // walk into the same wall with four pieces.
  assert.equal(exitsAvailable(), 1);
});

test("a piece is not one request, so the split leaves room to rotate", () => {
  /*
   * The arithmetic that failed on a real box: four working exits, nineteen
   * resting, and a piece that may rotate through four exits before giving up.
   * Splitting four ways there wants sixteen exit-uses out of four proxies, and
   * the unlucky piece spends all four attempts on dead ones — which fails the
   * whole read, because one missing piece does.
   */
  assert.equal(piecesFor(4), 2, "four exits is a two-way split, not a four-way one");
  assert.equal(piecesFor(8), 4);
  assert.equal(piecesFor(MAX_CHUNKS * 2), MAX_CHUNKS);
  assert.equal(piecesFor(1), 1);
  // Zero exits is a real answer, but no request at all is not a smaller one.
  assert.equal(piecesFor(0), 1);
  // And it never exceeds the mirror count, whatever the pool reports.
  assert.equal(piecesFor(1_000), MAX_CHUNKS);
});

/* ------------- a piece that fails is asked again, not given up on --------- */

test("a piece that fails once is retried, and the read succeeds", async (t) => {
  /*
   * The bug this fixes, from a screenshot: a 16 km walk cut seven ways failed
   * as a whole because ONE piece got a 502, while the other six sat there read
   * and discarded. A piece goes out through a public proxy and a public proxy
   * fails often — at a per-piece success rate that looks fine, a seven-way
   * split does not.
   */
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; forgetExits(); });
  forgetExits();

  let calls = 0;
  let failedOnce = false;
  globalThis.fetch = (async () => {
    calls += 1;
    if (!failedOnce) { failedOnce = true; return new Response("", { status: 502 }); }
    return new Response(JSON.stringify({ elements: [] }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const path = line(20_000);
  const pieces = piecesForRoute(pathLengthM(path), exitsAvailable());
  assert.ok(pieces > 1, "this route should have been split");

  const result = await fetchFacts(path, { base: "http://example.invalid/overpass" });
  assert.ok(result.ok, "one flaky piece must not fail the whole read");
  // Every piece once, plus the one retry. Only the failure is re-asked; the
  // pieces that came back are not thrown away and fetched again.
  assert.equal(calls, pieces + 1);
});

test("a rate limit ends the read at once, without spending the retries", async (t) => {
  /*
   * A 429 means the server already rotated this request through every exit it
   * has. Asking again a moment later asks the same exhausted pool the same
   * question and holds the limit open while the reader waits — and it is the
   * one failure with something to tell them: wait about a minute.
   */
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; forgetExits(); });
  forgetExits();

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "limited", exitsTried: 4 }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const path = line(20_000);
  const pieces = piecesForRoute(pathLengthM(path), exitsAvailable());
  const result = await fetchFacts(path, { base: "http://example.invalid/overpass" });

  assert.ok(!result.ok);
  assert.match(result.error, /rate limit/i);
  assert.equal(calls, pieces, "a rate limit must not be retried");
});
