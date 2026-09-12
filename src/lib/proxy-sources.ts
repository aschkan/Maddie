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

/**
 * Public lists, HTTP and HTTPS only. A source that 404s is skipped.
 *
 * Long on purpose. The yield from these is small — of a few hundred addresses
 * a handful answer Overpass — and a long route split many ways wants dozens of
 * working exits at once, so the way to more working proxies is more lists and
 * a bigger bite of each, not a longer probe of the same seven.
 *
 * Duplicates across lists cost nothing: `mergeProxyLists` collapses them before
 * anything is probed, and `refill` skips every address already known.
 *
 * A source that has gone away is a logged skip, not a failure — which is why
 * adding one is cheap and removing a dead one is housekeeping rather than a
 * fix.
 */
export const PROXY_SOURCES: string[] = [
  // proxifly, via a CDN — usually the freshest of these.
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt",
  "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt",
  // The long-standing aggregators.
  "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies_anonymous/http.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
  "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",
  "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt",
  "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
  "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt",
  "https://raw.githubusercontent.com/mmpx12/proxy-list/master/https.txt",
  "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
  "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt",
  "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt",
  "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt",
  "https://raw.githubusercontent.com/zloi-user/hideip.me/main/https.txt",
];

/**
 * The lists to fetch. Hardcoded, like everything else in the proxy system.
 *
 * A function rather than the constant itself so callers keep one name to
 * import if the selection ever grows a rule — and so a test can assert the
 * shipped list without reaching for an environment that no longer exists.
 */
export function sources(): string[] {
  return PROXY_SOURCES;
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
