// Maddie's own Overpass, over HTTP, on loopback only.
//
// The Overpass build ships a CGI program and expects Apache in front of it.
// This is the whole of what Maddie needs instead: POST (or GET) a query to
// /api/interpreter, get the answer back — and nothing else, with no
// dependencies, so it keeps running when a platform on the same box has broken
// its node_modules.
//
// Each query runs `osm3s_query` against the dispatcher, which holds the
// database open. At most MAX_RUNNING at once (the rest wait their turn), each
// one killed after TIMEOUT_MS. Bound to 127.0.0.1: nothing outside this
// machine can reach it, and nothing should.
//
//   node http.js        (run by the maddie-overpass-http systemd unit)

"use strict";

const http = require("node:http");
const { spawn } = require("node:child_process");

const PORT = 12345;
const HOST = "127.0.0.1";
const QUERY = "/srv/overpass/bin/osm3s_query";
const MAX_RUNNING = 4;
const TIMEOUT_MS = 90_000;
const MAX_BODY = 1_000_000;

let running = 0;
const waiting = [];

function slot() {
  if (running < MAX_RUNNING) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else running--;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/** `data=<query>` from a form body or a query string, or the body as written. */
function queryFrom(url, body) {
  const fromUrl = url.searchParams.get("data");
  if (fromUrl) return fromUrl;
  if (!body) return "";
  try {
    const form = new URLSearchParams(body);
    return form.get("data") ?? body;
  } catch {
    return body;
  }
}

function send(response, status, type, text) {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(text);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}`);

  if (url.pathname === "/api/status") {
    send(response, 200, "text/plain", `ok\nrunning ${running}, waiting ${waiting.length}\n`);
    return;
  }
  if (url.pathname !== "/api/interpreter") {
    send(response, 404, "text/plain", "not here\n");
    return;
  }

  let query;
  try {
    query = queryFrom(url, request.method === "POST" ? await readBody(request) : "");
  } catch {
    send(response, 413, "text/plain", "query too large\n");
    return;
  }
  if (!query.trim()) {
    send(response, 400, "text/plain", "no query\n");
    return;
  }

  await slot();
  const child = spawn(QUERY, [], { stdio: ["pipe", "pipe", "pipe"] });
  const out = [];
  const err = [];
  let killed = false;
  const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, TIMEOUT_MS);

  child.stdout.on("data", (chunk) => out.push(chunk));
  child.stderr.on("data", (chunk) => err.push(chunk));
  child.on("close", (code) => {
    clearTimeout(timer);
    release();
    const body = Buffer.concat(out);
    if (killed) {
      // 504, like the public servers: the forwarder reads it as "timed out".
      send(response, 504, "text/plain", "query timed out\n");
    } else if (code !== 0 || body.length === 0) {
      send(response, 500, "text/plain", Buffer.concat(err).toString("utf8").slice(0, 2000) || "query failed\n");
    } else {
      const json = /\[out:json\]/.test(query);
      send(response, 200, json ? "application/json" : "application/osm3s+xml", body);
    }
  });
  child.on("error", () => {
    clearTimeout(timer);
    release();
    send(response, 503, "text/plain", "overpass not available\n");
  });
  child.stdin.end(query);
});

server.listen(PORT, HOST, () => {
  console.log(`maddie overpass on http://${HOST}:${PORT}/api/interpreter`);
});
