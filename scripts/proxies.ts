/**
 * `npm run proxies` — find out which of the proxies actually work.
 *
 * Runs exactly what the server runs in the background, once, in the foreground,
 * and prints the table. This is the first thing to run on the box when the map
 * is empty, because it separates the three failures that look identical from
 * the outside:
 *
 *   * the entry proxy is unreachable          → every hop fails at "tcp"
 *   * the entry proxy refuses CONNECT         → every hop fails "refused with 403"
 *     to anything but port 443                  and the list is fine
 *   * the list really is dead                 → a mix of timeouts and refusals
 *
 *   npm run proxies                 probe them all and print the working ones
 *   npm run proxies -- --all        print every result, dead ones included
 *   npm run proxies -- --limit=50   stop after the first 50, for a quick look
 */

import fs from "node:fs";
import path from "node:path";

import { ProxyPool } from "../src/lib/proxy-pool.ts";
import { mergeProxyLists, sources, toRecords } from "../src/lib/proxy-sources.ts";

function value(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Download every source, skipping any that will not answer. */
async function scrape(): Promise<string[]> {
  const urls = sources();
  console.log(`scraping    : ${urls.length} source(s)`);
  const texts: string[] = [];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "maddie-proxy-scraper" },
      });
      if (!response.ok) {
        console.log(`   skipped  ${url} -> ${response.status}`);
        continue;
      }
      const text = await response.text();
      texts.push(text);
      console.log(`   ok       ${url} -> ${text.split("\n").length} lines`);
    } catch (error) {
      // One stale source must not take the run down; that is why there are
      // several of them.
      console.log(`   skipped  ${url} -> ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  const merged = mergeProxyLists(texts);
  console.log(`merged      : ${merged.length} unique addresses`);
  return merged;
}

async function main(): Promise<number> {
  const proxies = new ProxyPool();

  if (process.argv.includes("--scrape")) {
    const found = await scrape();
    if (found.length === 0) {
      console.log("");
      console.log("Every source failed. If this box cannot reach GitHub either, run the");
      console.log("scrape somewhere that can and copy proxies.json across.");
      return 1;
    }
    proxies.states = toRecords(found).map((record) => ({
      hop: { host: record.ip, port: record.port, label: `${record.ip}:${record.port}` },
      ok: null, latencyMs: null, lastProbe: 0, lastError: null,
      failures: 0, restingUntil: 0, inFlight: false, successes: 0,
    }));
  }

  if (!proxies.entry) {
    console.log("entry proxy : none — hops are reached directly, which is the usual case.");
    console.log("              Set ENTRY_PROXY in src/lib/proxy-pool.ts only when the");
    console.log("              proxies in the list are reachable solely through another one.");
  } else {
    console.log(`entry proxy : ${proxies.entry.label}`);
  }
  console.log(`probing     : ${proxies.probeUrl}`);
  console.log(`timeout     : ${proxies.probeTimeoutMs}ms`);

  const limit = Number(value("limit") ?? "0");
  if (limit > 0) proxies.states = proxies.states.slice(0, limit);
  console.log(`proxies     : ${proxies.states.length}`);
  if (proxies.states.length === 0) {
    console.log("");
    console.log("No proxies loaded. Run `npm run proxies -- --scrape --save` to go and");
    console.log("find some, or put a JSON list in ./proxies.json by hand.");
    return 1;
  }
  console.log("");

  const started = Date.now();
  const ticker = setInterval(() => {
    process.stdout.write(`\r  ${proxies.swept}/${proxies.states.length} probed…`);
  }, 1000);
  ticker.unref?.();

  await proxies.sweep();
  clearInterval(ticker);
  process.stdout.write("\r".padEnd(40) + "\r");

  const working = proxies.states.filter((state) => state.ok === true)
    .sort((a, b) => (a.latencyMs ?? 0) - (b.latencyMs ?? 0));
  const dead = proxies.states.filter((state) => state.ok !== true);

  for (const state of working) {
    console.log(`  ok    ${pad(state.hop.label, 24)} ${String(state.latencyMs ?? 0).padStart(6)}ms`);
  }

  if (process.argv.includes("--all")) {
    for (const state of dead) {
      console.log(`  dead  ${pad(state.hop.label, 24)} ${state.lastError ?? ""}`);
    }
  }

  const refused = dead.filter((state) => /refused with 403/.test(state.lastError ?? "")).length;
  console.log("");
  console.log(`${working.length} of ${proxies.states.length} answered, in ${Math.round((Date.now() - started) / 1000)}s.`);

  if (working.length === 0 && refused > dead.length / 2) {
    // The failure that looks like a dead list and is not.
    console.log("");
    console.log("⚠ Most hops were REFUSED at CONNECT with 403 by the entry proxy.");
    console.log("  That is its ACL, not the list: a Squid-style proxy allows CONNECT to");
    console.log("  443 and nothing else out of the box, and these hops are on 8080, 999,");
    console.log("  3128 and so on. Widen SSL_ports/Safe_ports on the entry proxy, or use");
    console.log("  an entry that permits CONNECT to arbitrary ports.");
  } else if (working.length === 0) {
    console.log("");
    console.log("Nothing answered. Check that the entry proxy is reachable from this box:");
    console.log(`  curl -x http://${proxies.entry?.label ?? "ENTRY"} -sI ${proxies.probeUrl}`);
    console.log("With no entry proxy set, that is this box's own route out being blocked.");
  } else {
    console.log("There is nothing to put in the env — there is no env. The server probes");
    console.log("and scrapes on its own schedule and keeps this ranking in memory. See");
    console.log("/api/osm/status on the running app.");
  }

  /*
   * Keep the ones that answered, fastest first.
   *
   * Only the working ones: a file of thousands of scraped addresses costs a
   * probe timeout apiece on every boot to rediscover that they are dead, and
   * the status page then reports a total that means nothing.
   */
  if (process.argv.includes("--save")) {
    if (working.length === 0) {
      console.log("");
      console.log("Nothing worked, so proxies.json is left alone rather than emptied.");
    } else {
      const latency = new Map(working.map((state) => [state.hop.label, state.latencyMs ?? 0]));
      const records = toRecords(working.map((state) => state.hop.label), latency);
      const file = path.join(process.cwd(), "proxies.json");
      fs.writeFileSync(file, `${JSON.stringify(records, null, 2)}\n`);
      console.log("");
      console.log(`Wrote ${records.length} working ${records.length === 1 ? "proxy" : "proxies"} to ${file}`);
    }
  }

  return working.length > 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("probe failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
