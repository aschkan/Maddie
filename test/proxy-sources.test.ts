import test from "node:test";
import assert from "node:assert/strict";

import { mergeProxyLists, parseProxyText, PROXY_SOURCES, sources, toRecords } from "../src/lib/proxy-sources.ts";
import { parseHopList } from "../src/lib/proxy-chain.ts";

test("a bare list of addresses is read", () => {
  assert.deepEqual(parseProxyText("1.2.3.4:8080\n5.6.7.8:3128\n"), ["1.2.3.4:8080", "5.6.7.8:3128"]);
});

test("every spelling these lists use is read", () => {
  // The sources disagree with each other about the format, and one of them
  // disagrees with itself between lines.
  const text = [
    "http://1.1.1.1:8080",
    "https://2.2.2.2:3128",
    "socks5://3.3.3.3:1080",     // read as an address; the caller decides
    "4.4.4.4:999 US 210ms",      // a country and a latency appended
    "5.5.5.5:8888,NL",
    "  6.6.6.6:80  ",
  ].join("\n");
  assert.deepEqual(parseProxyText(text), [
    "1.1.1.1:8080", "2.2.2.2:3128", "3.3.3.3:1080",
    "4.4.4.4:999", "5.5.5.5:8888", "6.6.6.6:80",
  ]);
});

test("anything that is not an address is dropped, not guessed at", () => {
  // Each malformed entry costs a probe timeout, and there are thousands.
  const text = [
    "# a comment",
    "",
    "not-an-address",
    "1.2.3.4",                 // no port
    "1.2.3.4:",                // empty port
    "1.2.3.4:0",               // not a port
    "1.2.3.4:70000",           // not a port
    "999.1.1.1:80",            // not an octet
    "example.com:8080",        // a hostname, and these lists never mean one
    "<html>404</html>",        // a source that answered with a page
  ].join("\n");
  assert.deepEqual(parseProxyText(text), []);
});

test("addresses that are never a proxy are dropped", () => {
  assert.deepEqual(parseProxyText("0.0.0.0:8080\n127.0.0.1:3128\n0.1.2.3:80\n"), []);
});

test("sources are merged and deduplicated, first seen first", () => {
  const merged = mergeProxyLists([
    "1.1.1.1:80\n2.2.2.2:80\n",
    "2.2.2.2:80\n3.3.3.3:80\n",     // the overlap every pair of these lists has
    "http://1.1.1.1:80\n",
  ]);
  assert.deepEqual(merged, ["1.1.1.1:80", "2.2.2.2:80", "3.3.3.3:80"]);
});

test("the same host on two ports is two proxies", () => {
  assert.deepEqual(mergeProxyLists(["9.9.9.9:80\n9.9.9.9:8080\n"]), ["9.9.9.9:80", "9.9.9.9:8080"]);
});

test("what it writes is what the pool reads back", () => {
  // The round trip that matters: scrape -> proxies.json -> loadHops.
  const records = toRecords(["1.2.3.4:8080", "5.6.7.8:3128"], new Map([["1.2.3.4:8080", 210]]));
  assert.equal(records[0]?.latencyMs, 210);
  assert.equal(records[1]?.latencyMs, undefined);

  const hops = parseHopList(JSON.stringify(records));
  assert.deepEqual(hops.map((hop) => hop.label), ["1.2.3.4:8080", "5.6.7.8:3128"]);
  assert.equal(hops[0]?.port, 8080);
});

test("every built-in source is an https URL", () => {
  assert.ok(PROXY_SOURCES.length >= 5);
  for (const url of PROXY_SOURCES) assert.match(url, /^https:\/\//);
  assert.equal(new Set(PROXY_SOURCES).size, PROXY_SOURCES.length, "a duplicated source");
});

test("no SOCKS list is fetched — this speaks HTTP CONNECT and refuses SOCKS", () => {
  for (const url of PROXY_SOURCES) assert.doesNotMatch(url, /socks/i);
});

test("the source list can be replaced from the environment", () => {
  assert.deepEqual(sources({ OSM_PROXY_SOURCES: "https://a/x.txt, https://b/y.txt" }),
    ["https://a/x.txt", "https://b/y.txt"]);
  assert.deepEqual(sources({ OSM_PROXY_SOURCES: "   " }), PROXY_SOURCES);
  assert.deepEqual(sources({}), PROXY_SOURCES);
});
