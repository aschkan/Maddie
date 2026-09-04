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

import { ProxyPool } from "../src/lib/proxy-pool.ts";

function value(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

async function main(): Promise<number> {
  const proxies = new ProxyPool();

  if (!proxies.entry) {
    console.log("OSM_PROXY_ENTRY is not set, so hops are probed DIRECTLY.");
    console.log("On the deployment this was written for that is not the arrangement:");
    console.log("  OSM_PROXY_ENTRY=192.168.11.165:2000");
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
    console.log("No proxies loaded. Set OSM_PROXY_LIST, or point OSM_PROXY_LIST_FILE at a");
    console.log("JSON or comma-separated list (the default is ./proxies.json).");
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
  } else {
    console.log("Put nothing else in the env: the server probes on its own schedule and");
    console.log("keeps this ranking in memory. See /api/osm/status on the running app.");
  }

  return working.length > 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("probe failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
