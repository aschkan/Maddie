/**
 * Reaching the outside through two proxies in a row. SERVER ONLY.
 *
 * The deployment this is for sits on a network where the public internet is
 * filtered. One HTTP proxy on the LAN is reachable; the public proxies that
 * can actually get out are not reachable directly. So the path is:
 *
 *     browser → this server → LAN proxy → a public proxy → OpenStreetMap
 *
 * The LAN proxy is deliberately NOT used as an exit on its own. It is the way
 * in to the second hop and nothing else, which is what was asked for and is
 * also the safer arrangement: this server's request pattern is not handed to
 * the LAN proxy's logs as a stream of map queries.
 *
 * Both hops are plain HTTP proxies, so the chain is two CONNECTs stacked:
 *
 *   1. TCP to the LAN proxy.
 *   2. `CONNECT hop:port` over it → a raw tunnel to the public proxy.
 *   3. `CONNECT target:443` down that tunnel → a raw tunnel to the target.
 *   4. TLS on top, with the TARGET's name for SNI.
 *
 * Node's fetch cannot do this — it takes no custom connection — so the request
 * is made with `node:https` and an explicit socket.
 *
 * The most common failure here is worth naming, because it looks like a dead
 * proxy and is not: a Squid-style proxy usually restricts CONNECT to port 443
 * out of the box, and step 2 asks it for port 8080, 999, 3128… If EVERY hop
 * fails at step 2 with 403, the LAN proxy's ACL is the thing to fix, not the
 * list.
 */

import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import zlib from "node:zlib";

export interface Hop {
  host: string;
  port: number;
  /** `host:port`, used as the identity of a hop everywhere else. */
  label: string;
  auth?: string;
}

/**
 * `1.2.3.4:8080`, `http://1.2.3.4:8080`, `http://user:pass@host:port`.
 *
 * SOCKS is rejected rather than silently treated as HTTP: the handshake is a
 * different protocol entirely, and a SOCKS proxy in an HTTP list fails in a way
 * that looks like an unreachable host.
 */
export function parseHop(spec: unknown): Hop | null {
  if (typeof spec !== "string") return null;
  const text = spec.trim();
  if (!text) return null;
  if (/^socks\d?:/i.test(text)) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  /*
   * The port, from the text rather than from `url.port`.
   *
   * `new URL("http://1.2.3.4:80")` normalises the default port away and leaves
   * `url.port` empty — and 472 of the 649 entries in the list this was built
   * for are on port 80. Trusting `url.port` silently threw away three quarters
   * of the list and left the code looking like it worked.
   *
   * A bare host with no port at all is still refused: in a proxy list that is
   * a truncated line, not an invitation to guess 80.
   */
  const afterScheme = withScheme.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const afterAuth = afterScheme.includes("@")
    ? afterScheme.slice(afterScheme.lastIndexOf("@") + 1)
    : afterScheme;
  const explicit = /^[^/]*:(\d{1,5})(?:$|\/)/.exec(afterAuth);
  const port = url.port ? Number(url.port) : explicit?.[1] ? Number(explicit[1]) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (!url.hostname) return null;

  const auth = url.username
    ? Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")
    : undefined;

  return {
    host: url.hostname,
    port,
    label: `${url.hostname}:${port}`,
    ...(auth ? { auth } : {}),
  };
}

/**
 * A list of hops from whatever shape it arrives in.
 *
 * Three shapes, because the list has arrived as all three: a JSON array from a
 * scraper (objects with `proxy`, or `ip` + `port`), a comma-separated env
 * variable, and a file with one per line.
 *
 * The scraper's own `https: true/false` field is IGNORED. It is unreliable —
 * the list this was built for has 649 entries and says `false` for every one of
 * them, which taken literally would mean not one can tunnel. The probe does the
 * real thing (a CONNECT through the chain to the real target) and that is the
 * only answer worth having.
 */
export function parseHopList(input: string | undefined | null): Hop[] {
  if (!input) return [];
  const text = input.trim();
  if (!text) return [];

  const specs: unknown[] = [];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === "string") { specs.push(entry); continue; }
          if (entry && typeof entry === "object") {
            const item = entry as { proxy?: unknown; ip?: unknown; host?: unknown; port?: unknown };
            if (typeof item.proxy === "string") { specs.push(item.proxy); continue; }
            const host = item.ip ?? item.host;
            if (typeof host === "string" && item.port !== undefined) specs.push(`${host}:${String(item.port)}`);
          }
        }
      }
    } catch {
      return [];
    }
  } else {
    specs.push(...text.split(/[\s,]+/));
  }

  const hops: Hop[] = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    const hop = parseHop(spec);
    if (!hop || seen.has(hop.label)) continue;
    seen.add(hop.label);
    hops.push(hop);
  }
  return hops;
}

/** The CONNECT request that opens one link of the chain. */
export function connectRequest(host: string, port: number, auth?: string): string {
  const target = `${host}:${port}`;
  const lines = [
    `CONNECT ${target} HTTP/1.1`,
    `Host: ${target}`,
    // Some proxies close the tunnel immediately without this.
    "Proxy-Connection: keep-alive",
  ];
  if (auth) lines.push(`Proxy-Authorization: Basic ${auth}`);
  return `${lines.join("\r\n")}\r\n\r\n`;
}

/** The status code out of a CONNECT reply, or null if it is not one. */
export function connectStatus(head: string): number | null {
  const match = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(head);
  return match?.[1] ? Number(match[1]) : null;
}

class ChainError extends Error {
  stage: string;
  constructor(stage: string, message: string) {
    super(message);
    this.name = "ChainError";
    this.stage = stage;
  }
}

function connectTcp(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new ChainError("tcp", `no TCP connection to ${host}:${port} within ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.once("error", (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(new ChainError("tcp", `${host}:${port}: ${error.message}`));
    });
  });
}

/**
 * Send CONNECT down an open socket and wait for the tunnel.
 *
 * Anything the proxy sent after the blank line is pushed back onto the socket:
 * a CONNECT reply should be followed by nothing, but a proxy that pipelines the
 * first bytes of the tunnel would otherwise have them swallowed here, and the
 * TLS handshake would fail with an error that says nothing about why.
 */
function sendConnect(socket: net.Socket, host: string, port: number, timeoutMs: number, auth?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let head = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      if (error) { socket.destroy(); reject(error); } else resolve();
    };

    const timer = setTimeout(
      () => finish(new ChainError("connect", `no CONNECT reply for ${host}:${port} within ${timeoutMs}ms`)),
      timeoutMs,
    );

    const onData = (chunk: Buffer) => {
      head += chunk.toString("latin1");
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) {
        if (head.length > 16_384) finish(new ChainError("connect", "CONNECT reply header was absurdly long"));
        return;
      }
      const leftover = Buffer.from(head.slice(end + 4), "latin1");
      const status = connectStatus(head);
      if (status === null) {
        finish(new ChainError("connect", `${host}:${port} did not answer CONNECT with HTTP`));
        return;
      }
      if (status < 200 || status > 299) {
        // 403 here on a non-443 port is almost always the entry proxy's ACL —
        // see the header of this file.
        finish(new ChainError("connect", `CONNECT ${host}:${port} refused with ${status}`));
        return;
      }
      if (leftover.length > 0) socket.unshift(leftover);
      finish();
    };

    const onError = (error: Error) => finish(new ChainError("connect", error.message));
    const onClose = () => finish(new ChainError("connect", `tunnel to ${host}:${port} closed during CONNECT`));

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
    socket.write(connectRequest(host, port, auth));
  });
}

export interface ChainOptions {
  /** The proxy this server can reach. Null means go straight to `hop`. */
  entry: Hop | null;
  /** The proxy that can reach the target. Null means the entry IS the exit. */
  hop: Hop | null;
  timeoutMs: number;
}

/**
 * A raw TCP tunnel to `host:port`, through however much of the chain is set.
 *
 * With both hops that is two stacked CONNECTs; with neither it is a plain
 * connection. The caller puts TLS on top — this returns the pipe, not the
 * conversation.
 */
export async function openTunnel(
  host: string,
  port: number,
  { entry, hop, timeoutMs }: ChainOptions,
): Promise<net.Socket> {
  const first = entry ?? hop;
  if (!first) return connectTcp(host, port, timeoutMs);

  const socket = await connectTcp(first.host, first.port, timeoutMs);
  try {
    if (entry && hop) {
      // Link one: out to the public proxy through the LAN one.
      await sendConnect(socket, hop.host, hop.port, timeoutMs, entry.auth);
      // Link two: out to the target through the public proxy.
      await sendConnect(socket, host, port, timeoutMs, hop.auth);
    } else {
      await sendConnect(socket, host, port, timeoutMs, first.auth);
    }
  } catch (error) {
    socket.destroy();
    throw error;
  }
  return socket;
}

function wrapTls(
  socket: net.Socket,
  servername: string,
  timeoutMs: number,
  ca?: string | Buffer,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername, ...(ca ? { ca } : {}) });
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new ChainError("tls", `TLS handshake with ${servername} took longer than ${timeoutMs}ms`));
    }, timeoutMs);
    secure.once("secureConnect", () => { clearTimeout(timer); resolve(secure); });
    secure.once("error", (error: Error) => {
      clearTimeout(timer);
      secure.destroy();
      reject(new ChainError("tls", `${servername}: ${error.message}`));
    });
  });
}

export interface ThroughResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  /** Wall time for the whole chain plus the request. */
  ms: number;
}

export interface ThroughRequest extends ChainOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /**
   * Extra trust, for the test's throwaway certificate.
   *
   * Here rather than `NODE_TLS_REJECT_UNAUTHORIZED=0`, which switches off
   * verification for the WHOLE process — including, in a test run, whatever
   * else happens to make a request.
   */
  ca?: string | Buffer;
}

/** How much of a reply to hold in memory. An Overpass answer is the big one. */
const MAX_BODY = 24 * 1024 * 1024;

/**
 * One request, through the chain. Rejects rather than returning a status for
 * anything below the HTTP layer — a refused CONNECT is not a 502 from the
 * target, and the two must not be reported as the same thing.
 */
export async function requestThrough(target: string, options: ThroughRequest): Promise<ThroughResponse> {
  const url = new URL(target);
  const secure = url.protocol === "https:";
  const port = Number(url.port) || (secure ? 443 : 80);
  const started = Date.now();

  /*
   * An explicit Agent whose `createConnection` hands over the tunnel.
   *
   * NOT `agent: false` with a `createConnection` option: `agent: false` builds
   * a fresh default Agent rather than none, so that option is never consulted
   * and the request quietly opens its OWN direct connection — which on
   * loopback succeeds, and in production goes straight out through the network
   * this whole file exists to work around. It is the worst kind of bug: it
   * looks like it works.
   *
   * A plain http.Agent even for an https target, because the TLS is already on
   * by the time the socket is handed over — the HTTP layer never needs to know.
   * (`http.request` would refuse an `https:` protocol against this agent, so
   * the request is described with host/port/path instead of a URL.)
   */
  const agent = new http.Agent({ keepAlive: false, maxSockets: 1 });
  let socket: net.Socket | null = null;

  agent.createConnection = ((_opts: unknown, callback: (error: Error | null, socket?: net.Socket) => void) => {
    openTunnel(url.hostname, port, options)
      .then(async (tunnel) => {
        socket = tunnel;
        if (!secure) { callback(null, tunnel); return; }
        const wrapped = await wrapTls(tunnel, url.hostname, options.timeoutMs, options.ca);
        socket = wrapped;
        callback(null, wrapped);
      })
      .catch((error: Error) => callback(error));
    // Node waits for the callback when nothing is returned synchronously.
    return undefined;
  }) as unknown as typeof agent.createConnection;

  return await new Promise<ThroughResponse>((resolve, reject) => {
    const body = options.body === undefined
      ? undefined
      : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body, "utf8");

    let settled = false;
    let overall: NodeJS.Timeout | null = null;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (overall) clearTimeout(overall);
      socket?.destroy();
      agent.destroy();
      reject(error);
    };
    const done = (value: ThroughResponse) => {
      if (settled) return;
      settled = true;
      if (overall) clearTimeout(overall);
      agent.destroy();
      resolve(value);
    };

    const request = http.request(
      {
        host: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? "GET",
        headers: {
          Host: url.host,
          // One socket, one request: the chain is torn down afterwards, and a
          // kept-alive socket would just hold two proxies open doing nothing.
          Connection: "close",
          "Accept-Encoding": "gzip, deflate",
          ...options.headers,
          ...(body ? { "Content-Length": String(body.length) } : {}),
        },
        agent,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            response.destroy();
            fail(new ChainError("body", "reply was larger than this will hold"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const raw = Buffer.concat(chunks);
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers[key] = value;
            else if (Array.isArray(value)) headers[key] = value.join(", ");
          }
          const encoding = (headers["content-encoding"] ?? "").toLowerCase();
          let decoded = raw;
          try {
            if (encoding.includes("gzip")) decoded = zlib.gunzipSync(raw);
            else if (encoding.includes("deflate")) decoded = zlib.inflateSync(raw);
          } catch {
            // A body claiming an encoding it does not have is passed through;
            // the caller's parser will say more about it than we can.
            decoded = raw;
          }
          if (decoded !== raw) delete headers["content-encoding"];
          // Both describe the body as it arrived, which is no longer the body
          // being handed on.
          delete headers["content-length"];
          delete headers["transfer-encoding"];
          done({ status: response.statusCode ?? 0, headers, body: decoded, ms: Date.now() - started });
        });
        response.on("error", (error: Error) => fail(new ChainError("body", error.message)));
      },
    );

    /*
     * ONE deadline for the whole exchange — two CONNECTs, a TLS handshake, the
     * request and the body.
     *
     * `request.setTimeout` would not do: it only starts counting once there is
     * a socket, and here the socket is the slow part. It is also deliberately
     * not cleared when the response HEADERS arrive: a stalled body through a
     * dying proxy is one of the ways this hangs, and clearing it there is how
     * that hang becomes permanent.
     */
    overall = setTimeout(
      () => fail(new ChainError("request", `nothing came back from ${url.hostname} within ${options.timeoutMs}ms`)),
      options.timeoutMs,
    );
    request.on("error", (error: Error) => fail(new ChainError("request", error.message)));

    if (body) request.write(body);
    request.end();
  });
}
