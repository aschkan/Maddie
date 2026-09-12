import test from "node:test";
import assert from "node:assert/strict";

import {
  CHUNK_MIN_M, MAX_CHUNKS, chunkPath, computeFacts, fetchFacts, overpassQuery,
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

test("a long route is cut, and never into more pieces than there are exits for", () => {
  const long = line(40_000);
  const chunks = chunkPath(long);
  assert.equal(chunks.length, MAX_CHUNKS);
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
  await fetchFacts(path, { base: "http://example.invalid/overpass" });
  // Serial would peak at one. Parallel is the whole point: the read takes as
  // long as the slowest piece rather than the sum of them.
  assert.equal(mostAtOnce, MAX_CHUNKS);
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

test("one missing piece fails the whole read rather than answering for the rest", async (t) => {
  // Counting what came back would leave the unfetched stretch with no ways
  // under it — reported as "nobody has mapped this", drawn grey, and wrong.
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });

  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    return call === 2 ? new Response("", { status: 500 }) : jsonReply([]);
  }) as typeof fetch;

  const result = await fetchFacts(line(20_000), { base: "http://example.invalid/overpass" });
  assert.ok(!result.ok);
  assert.match(result.error, /answered 500/);
  assert.match(result.error, /one of 4 parts/);
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
