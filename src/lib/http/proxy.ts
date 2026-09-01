/**
 * The forward-proxy pool.
 *
 * This server cannot reach most of the public internet directly, so every
 * server-side upstream goes through here. The decisions encoded below were all
 * paid for once already:
 *
 *  - a bare `host:port` is how proxies are written down, and ProxyAgent's parse
 *    error never mentions the missing scheme, so we add it;
 *  - private addresses are NEVER proxied: the local AI model lives there, and
 *    so does the proxy itself — asking a proxy to connect to itself is a loop;
 *  - proxies are ranked by TRUST TIER first and latency only within a tier. A
 *    public proxy operator sees which hosts this server looks up and when, and
 *    for an app that reasons about where a woman is at what hour, that must not
 *    be given away to a 600 ms measurement;
 *  - the probe target is an upstream the app actually depends on. A proxy that
 *    reaches a neutral connectivity endpoint but not PDOK is useless here.
 */

export type ProxyKind = "http" | "unsupported";

export interface ProxyEntry {
  /** Normalised absolute URL, e.g. `http://192.168.11.165:2000`. */
  url: string;
  /** As written in the environment, for logs the operator can recognise. */
  raw: string;
  kind: ProxyKind;
  /** 0 = the operator's own, 1 = borrowed. Never traded away for latency. */
  tier: 0 | 1;
}

const PRIVATE_V4 =
  /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/;

/** Hosts that must never be sent through a forward proxy. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "") return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (PRIVATE_V4.test(host)) return true;
  return false;
}

/**
 * NO_PROXY-shaped suffix match: `liara.ir` matches `liara.ir` and
 * `api.liara.ir`, and must NOT match `notliara.ir`.
 */
export function matchesBypass(hostname: string, bypass: readonly string[]): boolean {
  const host = hostname.trim().toLowerCase();
  return bypass.some((entryRaw) => {
    const entry = entryRaw.trim().toLowerCase().replace(/^\*?\./, "");
    if (entry === "") return false;
    if (entry === "*") return true;
    return host === entry || host.endsWith(`.${entry}`);
  });
}

export function shouldProxy(hostname: string, bypass: readonly string[]): boolean {
  if (isPrivateHost(hostname)) return false;
  if (matchesBypass(hostname, bypass)) return false;
  return true;
}

/**
 * Accepts `host:port`, `http://host:port`, `http://user:pass@host:port`.
 * SOCKS is recognised and marked unsupported rather than silently dropped:
 * undici's ProxyAgent cannot speak it, and a silent drop looks like a typo.
 */
export function normaliseProxy(raw: string, index = 1): ProxyEntry | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const withScheme = /^[a-z0-9+.-]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  const kind: ProxyKind = scheme === "http" || scheme === "https" ? "http" : "unsupported";
  if (parsed.hostname === "") return null;

  // `new URL` drops a default port, so `8.219.97.248:80` would come back as
  // `http://8.219.97.248` and stop matching the entry the operator wrote.
  const explicitPort = /:(\d+)$/.exec(withScheme)?.[1] ?? "";
  const authority = parsed.port !== "" || explicitPort === "" ? parsed.host : `${parsed.hostname}:${explicitPort}`;

  return {
    url: `${parsed.protocol}//${authority}`,
    raw: trimmed,
    kind,
    // The first entry is the operator's by convention (the env file says
    // "YOURS FIRST"), and anything on the private network is theirs by
    // definition — a stranger's box is not on this LAN.
    tier: index === 0 || isPrivateHost(parsed.hostname) ? 0 : 1,
  };
}

export function parseProxyPool(entries: readonly string[]): { usable: ProxyEntry[]; rejected: ProxyEntry[] } {
  const usable: ProxyEntry[] = [];
  const rejected: ProxyEntry[] = [];
  entries.forEach((raw, index) => {
    const entry = normaliseProxy(raw, index);
    if (entry === null) return;
    if (entry.kind === "http") usable.push(entry);
    else rejected.push(entry);
  });
  return { usable, rejected };
}

export interface ProxyHealth {
  entry: ProxyEntry;
  /** Milliseconds to the probe target, or null when never measured. */
  latencyMs: number | null;
  /** Epoch ms; while in the future the proxy is skipped. */
  restingUntil: number;
  lastProbeAt: number;
  lastError: string | null;
}

/**
 * Trust tier first, then latency, then the order the operator wrote them in.
 * An unmeasured proxy sorts after measured ones in the same tier but is still
 * tried — "not probed yet" is not "known bad".
 */
export function rankProxies(pool: readonly ProxyHealth[], now = Date.now()): ProxyHealth[] {
  const live = pool.filter((candidate) => candidate.restingUntil <= now);
  const resting = pool.filter((candidate) => candidate.restingUntil > now);
  const byPreference = (a: ProxyHealth, b: ProxyHealth): number => {
    if (a.entry.tier !== b.entry.tier) return a.entry.tier - b.entry.tier;
    const left = a.latencyMs ?? Number.MAX_SAFE_INTEGER;
    const right = b.latencyMs ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return 0;
  };
  // Resting proxies are kept at the tail rather than dropped: with a small
  // pool, a rested-but-working proxy beats no proxy at all.
  return [...live.sort(byPreference), ...resting.sort(byPreference)];
}
