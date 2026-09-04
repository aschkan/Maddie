import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import type { Duplex } from "node:stream";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  connectRequest, connectStatus, openTunnel, parseHop, parseHopList, requestThrough,
} from "../src/lib/proxy-chain.ts";

/* ------------------------------- parsing ---------------------------------- */

test("a proxy is recognised with or without a scheme", () => {
  assert.deepEqual(parseHop("1.2.3.4:8080"), { host: "1.2.3.4", port: 8080, label: "1.2.3.4:8080" });
  assert.deepEqual(parseHop("http://1.2.3.4:8080"), { host: "1.2.3.4", port: 8080, label: "1.2.3.4:8080" });
  assert.equal(parseHop("  1.2.3.4:8080  ")?.label, "1.2.3.4:8080");
});

test("SOCKS is refused rather than treated as HTTP", () => {
  // The handshake is a different protocol. A SOCKS entry in an HTTP list fails
  // in a way that looks exactly like an unreachable host, and one did.
  assert.equal(parseHop("socks5://85.234.100.149:1080"), null);
  assert.equal(parseHop("socks4://1.2.3.4:1080"), null);
});

test("the default port is kept when it is written down", () => {
  // `new URL("http://1.2.3.4:80")` normalises `:80` away and leaves url.port
  // empty. Reading the port from there dropped 472 of the 649 entries in the
  // real list — and looked like it worked, because 177 remained.
  assert.equal(parseHop("http://52.140.40.92:80")?.port, 80);
  assert.equal(parseHop("52.140.40.92:80")?.label, "52.140.40.92:80");
  assert.equal(parseHop("https://1.2.3.4:443")?.port, 443);
});

test("nonsense is dropped, not turned into a host", () => {
  for (const bad of ["", "   ", "1.2.3.4", "1.2.3.4:0", "1.2.3.4:70000", "http://:8080", null, 42, undefined]) {
    assert.equal(parseHop(bad), null, String(bad));
  }
});

test("credentials in a proxy URL become a Proxy-Authorization header", () => {
  const hop = parseHop("http://bob:s3cret@1.2.3.4:8080");
  assert.equal(hop?.auth, Buffer.from("bob:s3cret").toString("base64"));
  // The label is the identity used everywhere else, and must not carry them.
  assert.equal(hop?.label, "1.2.3.4:8080");
});

test("the scraper's JSON is read, and its own https flag is ignored", () => {
  // Every entry in the list this was built for says `https: false`. Believing
  // that would mean not one of 649 can tunnel; the probe decides instead.
  const hops = parseHopList(JSON.stringify([
    { proxy: "http://201.159.99.37:8081", https: false },
    { ip: "85.187.224.21", port: 8080, https: false },
    { proxy: "socks5://9.9.9.9:1080" },
    { nothing: true },
  ]));
  assert.deepEqual(hops.map((hop) => hop.label), ["201.159.99.37:8081", "85.187.224.21:8080"]);
});

test("a comma or newline list is read too, and duplicates collapse", () => {
  const hops = parseHopList("1.2.3.4:8080, 5.6.7.8:3128\n1.2.3.4:8080");
  assert.deepEqual(hops.map((hop) => hop.label), ["1.2.3.4:8080", "5.6.7.8:3128"]);
  assert.deepEqual(parseHopList(""), []);
  assert.deepEqual(parseHopList(undefined), []);
  assert.deepEqual(parseHopList("[not json"), []);
});

test("the committed proxy list parses to something usable", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = fs.readFileSync(path.join(here, "..", "proxies.json"), "utf8");
  const hops = parseHopList(raw);
  assert.ok(hops.length > 500, `expected the full list, got ${hops.length}`);
  assert.ok(hops.every((hop) => hop.port > 0 && hop.host.length > 0));
});

/* ------------------------------ the protocol ------------------------------- */

test("CONNECT names the host and port, and carries auth when there is any", () => {
  const line = connectRequest("example.org", 443);
  assert.match(line, /^CONNECT example\.org:443 HTTP\/1\.1\r\n/);
  assert.match(line, /Host: example\.org:443\r\n/);
  assert.ok(line.endsWith("\r\n\r\n"));
  assert.doesNotMatch(line, /Proxy-Authorization/);
  assert.match(connectRequest("h", 1, "dXNlcjpwdw=="), /Proxy-Authorization: Basic dXNlcjpwdw==/);
});

test("the CONNECT reply status is read, and rubbish is not mistaken for 200", () => {
  assert.equal(connectStatus("HTTP/1.1 200 Connection established\r\n\r\n"), 200);
  assert.equal(connectStatus("HTTP/1.0 403 Forbidden\r\n\r\n"), 403);
  assert.equal(connectStatus("<html>blocked</html>"), null);
  assert.equal(connectStatus(""), null);
});

/* --------------------------- the chain, for real --------------------------- */
/*
 * These stand up two HTTP proxies and a target on loopback and run the real
 * double CONNECT through them. Nothing leaves the machine — the ports are
 * ephemeral and everything is torn down inside the test — but it is the only
 * way to prove the part of this app most likely to be silently wrong.
 */

/**
 * A minimal CONNECT proxy. `refusePorts` says no, like a Squid ACL does.
 *
 * Every socket it opens is tracked, because a tunnelled socket belongs to
 * neither end's `close()` and keeps the process alive after the test is over —
 * which the runner reports as the test failing rather than as a leak.
 */
function proxy(options: { refusePorts?: number[]; label: string }) {
  const seen: string[] = [];
  // The client half of a CONNECT arrives as a Duplex, not a net.Socket.
  const open: Duplex[] = [];
  const server = http.createServer((_request, response) => {
    response.writeHead(405).end("only CONNECT here");
  });

  server.on("connect", (request, clientSocket, head) => {
    open.push(clientSocket);
    const [host, portText] = (request.url ?? "").split(":");
    const port = Number(portText);
    seen.push(request.url ?? "");

    if (!host || !Number.isInteger(port)) {
      clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    if (options.refusePorts?.includes(port)) {
      // Exactly what a default Squid says to CONNECT on a non-443 port.
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }

    const upstream = net.connect(port, host, () => {
      open.push(upstream);
      clientSocket.write("HTTP/1.1 200 Connection established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
    clientSocket.on("error", () => upstream.destroy());
  });

  return { server, seen, open };
}

function listen(server: net.Server | http.Server | https.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

/**
 * Shut a server down for real.
 *
 * `close()` alone waits for every connection to end, and a CONNECT tunnel does
 * not end on its own — so the callback never fires, the test never finishes,
 * and node exits with the tests still pending.
 */
function close(server: http.Server | https.Server, sockets: Duplex[] = []): Promise<void> {
  for (const socket of sockets) socket.destroy();
  server.closeAllConnections();
  return new Promise((resolve) => { server.close(() => resolve()); });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const CERT = {
  cert: fs.readFileSync(path.join(here, "fixtures", "localhost-cert.pem")),
  key: fs.readFileSync(path.join(here, "fixtures", "localhost-key.pem")),
};
/* Trust it for these requests only. NODE_TLS_REJECT_UNAUTHORIZED=0 would
   switch verification off for everything else in the run as well. */
const CA = CERT.cert;

test("a request goes out through BOTH proxies, in order, and comes back", async () => {
  const target = https.createServer(CERT, (request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ path: request.url, method: request.method, ua: request.headers["user-agent"] }));
  });
  const targetPort = await listen(target);

  const hop = proxy({ label: "hop" });
  const hopPort = await listen(hop.server);
  const entry = proxy({ label: "entry" });
  const entryPort = await listen(entry.server);

  try {
    const response = await requestThrough(`https://localhost:${targetPort}/api/status`, {
      entry: { host: "127.0.0.1", port: entryPort, label: `127.0.0.1:${entryPort}` },
      hop: { host: "127.0.0.1", port: hopPort, label: `127.0.0.1:${hopPort}` },
      timeoutMs: 8_000,
      ca: CA,
      headers: { "User-Agent": "Maddie/test" },
    });

    assert.equal(response.status, 200);
    const body = JSON.parse(response.body.toString()) as { path: string; ua: string };
    assert.equal(body.path, "/api/status");
    // Overpass and Nominatim both ask for this, and Nominatim blocks without it.
    assert.equal(body.ua, "Maddie/test");

    // The order is the whole point: the entry proxy is asked for the HOP, and
    // the hop is asked for the TARGET. Reversed, the LAN proxy would be the
    // exit — which is the arrangement this is built to avoid.
    assert.deepEqual(entry.seen, [`127.0.0.1:${hopPort}`]);
    assert.deepEqual(hop.seen, [`localhost:${targetPort}`]);
  } finally {
    await Promise.all([
      close(target), close(hop.server, hop.open), close(entry.server, entry.open),
    ]);
  }
});

test("a POST body survives the chain", async () => {
  // Overpass queries are POSTed, and they are the reason this exists.
  const target = https.createServer(CERT, (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(Buffer.concat(chunks));
    });
  });
  const targetPort = await listen(target);
  const hop = proxy({ label: "hop" });
  const hopPort = await listen(hop.server);
  const entry = proxy({ label: "entry" });
  const entryPort = await listen(entry.server);

  try {
    const query = "data=" + encodeURIComponent("[out:json];node(1);out;");
    const response = await requestThrough(`https://localhost:${targetPort}/api/interpreter`, {
      entry: { host: "127.0.0.1", port: entryPort, label: "entry" },
      hop: { host: "127.0.0.1", port: hopPort, label: "hop" },
      timeoutMs: 8_000,
      ca: CA,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: query,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.toString(), query);
  } finally {
    await Promise.all([
      close(target), close(hop.server, hop.open), close(entry.server, entry.open),
    ]);
  }
});

test("an entry proxy that refuses CONNECT to the hop's port says so clearly", async () => {
  // THE failure that looks like a dead proxy list and is not. A Squid-style
  // proxy allows CONNECT to 443 and nothing else out of the box, and every hop
  // in the list is on some other port.
  const hop = proxy({ label: "hop" });
  const hopPort = await listen(hop.server);
  const entry = proxy({ label: "entry", refusePorts: [hopPort] });
  const entryPort = await listen(entry.server);

  try {
    await assert.rejects(
      openTunnel("localhost", 443, {
        entry: { host: "127.0.0.1", port: entryPort, label: "entry" },
        hop: { host: "127.0.0.1", port: hopPort, label: "hop" },
        timeoutMs: 4_000,
      }),
      (error: Error) => {
        assert.match(error.message, /refused with 403/);
        assert.match(error.message, new RegExp(String(hopPort)));
        return true;
      },
    );
    // It never got as far as asking the hop for anything.
    assert.deepEqual(hop.seen, []);
  } finally {
    await Promise.all([close(hop.server, hop.open), close(entry.server, entry.open)]);
  }
});

test("an unreachable entry proxy fails fast, and says which stage", async () => {
  const dead = { host: "127.0.0.1", port: 1, label: "127.0.0.1:1" };
  await assert.rejects(
    openTunnel("localhost", 443, { entry: dead, hop: null, timeoutMs: 2_000 }),
    /127\.0\.0\.1:1/,
  );
});

test("with no chain configured it goes straight out", async () => {
  const target = http.createServer((_request, response) => response.end("plain"));
  const targetPort = await listen(target);
  try {
    const response = await requestThrough(`http://127.0.0.1:${targetPort}/x`, {
      entry: null, hop: null, timeoutMs: 4_000,
    });
    assert.equal(response.body.toString(), "plain");
  } finally {
    await close(target);
  }
});

test("a gzipped reply is unpacked, and the header stops claiming otherwise", async () => {
  // Overpass replies are hundreds of kilobytes and gzip matters over a chain of
  // two proxies. A body still compressed with the header stripped, or the other
  // way round, is a parse error that looks like a corrupt upstream.
  const payload = JSON.stringify({ elements: Array.from({ length: 50 }, (_, i) => ({ id: i })) });
  const target = https.createServer(CERT, (_request, response) => {
    response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
    response.end(zlib.gzipSync(Buffer.from(payload)));
  });
  const targetPort = await listen(target);
  try {
    const response = await requestThrough(`https://localhost:${targetPort}/`, {
      entry: null, hop: null, timeoutMs: 4_000, ca: CA,
    });
    assert.equal(response.body.toString(), payload);
    assert.equal(response.headers["content-encoding"], undefined);
  } finally {
    await close(target);
  }
});
