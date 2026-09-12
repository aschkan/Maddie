/**
 * Where to get a proxy list from. SERVER ONLY — used by `npm run proxies`.
 *
 * Ported from the PowerShell script this was being done with by hand on a
 * Windows box, because the servers are Ubuntu now. Same sources, same
 * merge-and-dedupe, one difference that matters:
 *
 * **The probe is Overpass, not `api.ipify.org`.** A generic connectivity check
 * says a proxy is alive; it does not say it can reach the one service this app
 * cannot work without. That gap is not small — a list where 28 proxies passed
 * an ipify check had 3 that could actually fetch Overpass, and two of the
 * failures were proxies intercepting TLS, which an ipify check over the same
 * intercepted connection is perfectly happy with. `proxy-pool.ts` does the
 * probing and already asks the right question.
 *
 * SOCKS lists are deliberately NOT fetched. `proxy-chain.ts` speaks HTTP
 * CONNECT and refuses a SOCKS spec rather than treating it as HTTP, so
 * downloading thousands of them would only be a longer list of things that
 * cannot work here.
 */

/** Public lists, HTTP and HTTPS only. A source that 404s is skipped. */
export const PROXY_SOURCES: string[] = [
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt",
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
];

/** `OSM_PROXY_SOURCES`, comma or newline separated, replaces the list above. */
export function sources(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.OSM_PROXY_SOURCES?.trim();
  if (!raw) return PROXY_SOURCES;
  const list = raw.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
  return list.length > 0 ? list : PROXY_SOURCES;
}

/** `1.2.3.4:8080`, with an optional scheme and optional trailing junk. */
const ADDRESS = /^(?:\w+:\/\/)?((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})$/;

/**
 * One downloaded list → the addresses in it.
 *
 * Every source spells it differently: bare `ip:port`, `http://ip:port`,
 * `socks5://ip:port`, sometimes with a country or a latency appended after a
 * space. Anything that is not an address is dropped rather than guessed at —
 * a malformed entry costs a probe timeout apiece, and there are thousands.
 */
export function parseProxyText(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const first = line.trim().split(/[\s,|]+/)[0];
    if (!first) continue;
    const match = ADDRESS.exec(first);
    if (!match) continue;

    const [, host = "", portText = ""] = match;
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) continue;
    // 0.0.0.0 and friends are in these lists and are never a proxy.
    if (host.startsWith("0.") || host === "127.0.0.1") continue;
    if (host.split(".").some((part) => Number(part) > 255)) continue;

    out.push(`${host}:${port}`);
  }
  return out;
}

/** Several downloaded lists → one deduplicated list, in first-seen order. */
export function mergeProxyLists(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    for (const address of parseProxyText(text)) {
      if (seen.has(address)) continue;
      seen.add(address);
      out.push(address);
    }
  }
  return out;
}

/** The shape `proxies.json` is written in, and `parseHopList` reads. */
export interface ProxyRecord {
  proxy: string;
  protocol: "http";
  ip: string;
  port: number;
  latencyMs?: number;
}

export function toRecords(addresses: readonly string[], latency?: Map<string, number>): ProxyRecord[] {
  const out: ProxyRecord[] = [];
  for (const address of addresses) {
    const cut = address.lastIndexOf(":");
    const ip = address.slice(0, cut);
    const port = Number(address.slice(cut + 1));
    if (!ip || !Number.isInteger(port)) continue;
    const ms = latency?.get(address);
    out.push({
      proxy: `http://${address}`,
      protocol: "http",
      ip,
      port,
      ...(typeof ms === "number" ? { latencyMs: ms } : {}),
    });
  }
  return out;
}
