# Maddie — working notes

A map where you set a start and a destination, compare the ways round, and see
what OpenStreetMap records about each. Read `README.md` first; this file is the
short list of things that will bite you while editing.

## Shape of it

- `src/lib/osrm.ts` — build the route request, parse the reply. Pure, tested.
- `src/lib/geocode.ts` — Nominatim search. Pure parser + a fetch wrapper.
- `src/lib/geo.ts` — distance, sampling, bounding boxes. Pure, tested.
- `src/lib/overpass.ts` — the one data source: what OSM says about the streets
  a route runs along.
- `src/lib/layers.ts` — the same source, over the visible map: safe spots,
  lamps, lit streets.
- `src/lib/score.ts` — the verdict. **Deterministic. No model involved.**
- `src/lib/compare.ts` — which route is preferred, and when to say none is.
- `src/lib/reports.ts` — the crime layer. Entered by people, never scored.
- `src/lib/seed-data.ts` — the example data. **Read its header before touching it.**
- `src/lib/db.ts` — MongoDB, when `MONGO_URI` is set. **Server only.**
- `scripts/seed.ts` — `npm run seed`, which the proxy's reseed button runs.
  **Destructive by default. Read the seed section below.**
- `src/lib/seed-flags.ts` — the flag contract, pure and tested.
- `src/lib/ai.ts` — local model, Liara fallback. **Server only.**
- `src/lib/proxy-chain.ts` — two HTTP proxies in a row. **Server only.**
- `src/lib/proxy-pool.ts` — which of them work, and which to use next.
- `src/lib/osm-forward.ts` — the fixed table of upstreams the forwarder allows.
- `scripts/proxies.ts` — `npm run proxies`, the first thing to run on the box.
- `src/app/api/assess/route.ts` — the model endpoint.
- `src/app/api/reports/route.ts` — the crime layer's storage.
- `src/app/api/osm/[service]/[[...path]]/route.ts` — OSM through this server.
- `src/components/` — the map, the planner, the filters, the comparison, the
  search box, the safety panel.

Tiles, routing, search and the OSM query are fetched by the BROWSER **by
default**. That is why a proxy configured on the server does nothing for them
unless the forwarder below is switched on.

**The API routes each exist for a reason the browser cannot do itself:** the
model cannot be called from the browser (the LAN box is unreachable from a
phone, and the Liara key would be shipped to every visitor), the reports need a
connection string, and `/api/osm/*` is for the deployment whose network cannot
reach OpenStreetMap at all.

## The forwarder, and the two-proxy chain

Set `NEXT_PUBLIC_OVERPASS_URL=/api/osm/overpass` (and the OSRM, Nominatim and
tile equivalents) and the browser asks THIS server, which goes out through
`OSM_PROXY_ENTRY` → one of `OSM_PROXY_LIST` → OpenStreetMap. Two plain HTTP
proxies means two stacked `CONNECT`s with TLS on top; see the header of
`proxy-chain.ts`.

**The entry proxy is never the exit.** It is the way in to the second hop and
nothing else — that was the requirement, and it is also what keeps this
server's map queries out of the LAN proxy's logs. `test/proxy-chain.test.ts`
asserts the ORDER of the two CONNECTs for exactly that reason.

The upstream comes from a fixed table in `osm-forward.ts` and can never be
named by the request. A forwarder whose target is a query parameter is an open
proxy, and an open proxy on a public server is somebody's problem within a day.

## The split that matters

**Code computes the score. The model writes the sentence.**

A 4B model asked to invent a safety number produces a confident number with
nothing behind it, and this is not a subject to be confidently wrong about. So
`score.ts` turns counts into a verdict, and the model is handed those numbers
and asked to explain them. If no model answers, the page still shows the score
and the findings — only the prose is lost.

When the verdict is `unknown` the model is **not called at all**. There is
nothing to explain but the gap, and a model asked to comment anyway produces a
sentence that sounds like an answer. That was observed: a fluent "most of this
walk is on lit streets" printed directly under "Not enough map data".

## "Preferred", never "safe"

The badge in `RouteChoices` says **Preferred**, and `compare.ts` spells out why
in the sentence under it. What the data supports is "better lit and busier than
the other one" — much smaller than a claim about safety, and the word has to
match the claim. A rename here is a change to what the app promises, not a
wording tweak.

`compare.ts` also refuses to badge anything when the two best routes are within
`MEANINGFUL_MARGIN` of each other. The score comes from sampled counts along a
line and moves by several points on a handful of samples; badging a 63 over a 61
invents a distinction the map cannot support.

## The crime layer holds no crime data

There is no open point-level dataset for harassment, catcalling, sexual assault
or rape. Official figures are per neighbourhood per month — the same objection
as below — and the categories that matter most are the least reported. So the
purple layer holds **reports people entered**, starting empty, and it never
reaches `score.ts`.

Two backends, and which one is in use is printed in the panel: rows in the
`maddie` database when `MONGO_URI` is set, `localStorage` when it is not. A
report somebody believed they had filed, visible to nobody, is worse than not
being able to file one.

If a real dataset is ever wired in, the empty-state sentence in `FilterPanel`
has to change with it: right now it says an empty map means nobody wrote
anything down, and that has to stay true.

### Example data is a different object, everywhere

`npm run seed` invents points so the filter can be demonstrated before the
interviews exist. Every one carries `source: "example"`, and **three separate
places in the UI key off that field**: a hollow dashed ring instead of a solid
dot, `EXAMPLE DATA — NOT A REAL REPORT` as the first line of the popup, and the
banner in `FilterPanel`. A fabricated point sits on a real street; those three
are the only thing between it and being read as a record of a real event, so
none of them is decoration and none of them may be quietly dropped.

`parseReports` defaults an unmarked report to `community`, not `example`. That
is the right way round: the failure that matters is an invented point being
promoted to a real one, not the reverse.

The seed writes visibly placeholder notes. Invented first-person testimony is
exactly what the real interviews will supply, and a convincing fake of it in the
same collection is how a fake ends up quoted as a finding.

## Secrets and SSL — owned by the reverse proxy

Both are run from the [platform reverse proxy][proxy]'s panel, and its README is the
spec for both: **§ "How secrets work"** and **§ "SSL — getting and renewing
certificates"**. Read those before changing anything here that touches either.

[proxy]: https://github.com/aschkan/platform-reverse-proxy#how-secrets-work

- **This app's secrets are **none**.** They are declared in the `secrets` array
  on this platform's entry in the proxy's `platforms.json`, NOT guessed by the
  proxy. That list used to be hardcoded there — `JWT_SECRET`, `JWT_ADMIN_SECRET`,
  `ENCRYPTION_KEY` for every platform — which generated variables most apps here
  never read while reporting success. **Adding a secret to this app means adding
  it to that declaration too**, or 🔑 Fix secrets will not know about it.
- **It does not serve the operator API**, so it takes no `OPERATOR_KEY`. The
  panel refuses to write one rather than leaving a key nothing reads — which
  previously looked like the problem was solved.
- **Fill in, never rotate.** A secret already set is kept. Regenerating a signing
  key signs every user out; regenerating an encryption key makes stored data
  permanently unreadable.
- **Secrets arrive from `env/<name>.env` on the proxy**, merged over `process.env`
  when the app is spawned. `dotenv` here will not override an already-set variable,
  so that file wins — a value in this checkout's `.env` is the fallback, not the
  source of truth.
- **`"secrets": []` is Maddie's declaration, and it is an answer.** No signing
  key, no session, no login, nothing encrypted at rest. `MONGO_URI` is
  configuration, not a generated secret. Declaring none is deliberately
  different from having no declaration at all — do not delete the empty array.

- **TLS is not this app's job.** It listens on plain HTTP on loopback; the proxy
  terminates TLS in front of it. The certificate for `maddie.arsaces.ir` and `*.maddie.arsaces.ir` is
  issued by the panel's 🔒 SSL button — Let's Encrypt over DNS-01, with the TXT
  records added by hand (expect **two** under one `_acme-challenge.maddie.arsaces.ir` name),
  through an HTTP proxy because this box cannot resolve the ACME API. Manual-DNS
  certificates do not auto-renew: 90 days, renew inside the last 30, and the card
  shows the countdown.

## Seeding — a contract this repo does not get to reinvent

`npm run seed` is what the reverse proxy's **💣 Reseed DB** button runs, and the
rules it follows are written down once for every platform on that box, in the
[reverse proxy's README][seed-contract] under *The seed contract*. **Read that
before changing `scripts/seed.ts`.**

[seed-contract]: https://github.com/aschkan/platform-reverse-proxy#the-seed-contract--what-a-platforms-npm-run-seed-must-do

- **It wipes by default, and here that means real material.** `dropDatabase()`,
  not a `deleteMany({ source: "example" })` — the collection holds reports
  people typed about being followed, harassed or assaulted, and there is no
  other copy. That is the cost of the standard default, and it is why `--keep`
  exists and is named in the header, the README and the summary.
- **`--force` beats every keep/skip flag and every `SEED_*` env var.** The
  button's whole point is that an operator wanting a known-good database
  presses one thing. `resolveSeedFlags` is pure and `test/seed-flags.test.ts`
  pins the rule — which matters more here than anywhere: proving it the other
  way means running a destructive script against a live collection.
- **The example reports are built BEFORE anything is deleted.** A bad `--count`
  or a throwing generator after the wipe leaves an empty collection and takes
  the real reports with it. A seed that declines to run costs nothing.
- **The indexes go with the drop, so they are rebuilt.** `reportsCollection()`
  owns them (unique `id`, 2dsphere on `loc`, `source`, `atMs`); asking for the
  collection again is what puts them back. A 2dsphere that quietly did not come
  back is a geo query that returns nothing on a map that looks fine.
- **No `MONGO_URI` is not a failure.** This deployment keeps reports in the
  browser; the seed says so and exits 0. Do not make it an error.
- **`--clear` still works** as an alias for `--no-demo`. It is in the README and
  in every shipped version of the script's header.
- **There is no Redis and there will not be one.** Nothing in the seed, the
  build or the boot may depend on a cache server — that is the rule across every
  platform on the box.
- **The summary block at the end is plain `console.log`**, like every other
  platform's. Maddie has no accounts, so what goes there instead of logins is
  what the map will now show and how much of it is invented.

## Why OpenStreetMap and not crime figures

Recorded crime is published per neighbourhood per month. A walking route usually
sits inside one neighbourhood, so it gives every candidate route the same number
— it cannot answer the question being asked. OSM changes metre by metre, carries
`lit=*` (what most decides how a street feels after dark, and the one thing you
can act on by walking a different way), and is the same data OSRM routed on.

## Traps — each one has a test

- **OSRM takes lon,lat. Leaflet takes lat,lng.** Swapping them still returns a
  route, just one on the other side of the world. `routeUrl` and `parseRoutes`
  own that conversion; nothing else should do it by hand.
- **OSRM reports failure in the body with an HTTP 200.** `response.ok` alone
  never tells you whether there is a route — check `code`.
- **Nominatim returns lat/lon as strings.** `Number("")` is `0`, and 0,0 is a
  real place in the Gulf of Guinea. Unparseable hits are dropped, not defaulted.
- **A missing distance must not render as `NaN km`** — that reads as a broken
  app rather than a missing number.
- The public OSRM demo server reliably serves only the **driving** profile;
  foot and bike come and go. A 400 there is explained, not shown as a number.
- **An untagged street is not an unlit one.** `unlitSamples` and
  `unknownLitSamples` are counted separately and must stay separate: most
  streets in most of the world carry no `lit` tag, and folding the two together
  reports a gap in the map as a dark street.
- **A fraction from a tiny denominator is not evidence.** Two lit samples and no
  unlit ones is "100% lit" arithmetically. Shipping that unshrunk produced a
  green "Looks fine · 71/100" sitting directly above "lighting is mapped for 1%
  of the route". `score.ts` shrinks the lit fraction towards neutral below ~15
  known samples, and the low-coverage gate gets you out entirely.
- **Both plural forms are passed to `plural()`**, because appending "s" to a
  phrase gives "0 shop or cafes" — under a safety verdict, that reads as a
  broken app.
- **`opening_hours` is not parsed.** It is a small language (`Mo-Fr 09:00-18:00;
  PH off`), and half-reading it gives a confident "open now" for a shop that
  shut at six. `alwaysOpen()` recognises `24/7` and nothing else; everything
  else is printed as written.
- **A route the map says nothing about must not win a comparison by default,
  nor lose by default.** `score: null` means no opinion, and `compare.ts`
  treats it as no opinion in both directions.
- **Layer ids reach Overpass as query text**, and Overpass QL has no escaping.
  `layerQuery` filters the requested ids against `SAFE_SPOTS` rather than
  interpolating them, so a stale id becomes nothing rather than a fragment of
  query.
- **Routes are read one at a time.** Overpass gives out a couple of slots per
  IP; three parallel reads earn a 429 that also kills the layers on the map,
  and the whole page then looks broken.
- **A bare `npm run seed` now wipes the whole database**, community reports
  included. It used to keep them and replace only the example ones; that is
  `--keep` now. The change was to make one button mean one thing on every
  platform — see the seeding section above.
- **A stored point is GeoJSON: `[lng, lat]`, longitude first.** The same trap as
  OSRM, and `2dsphere` indexes the wrong order perfectly happily — you get
  results, for somewhere in the Gulf of Guinea. `toDoc`/`fromDoc` own it.
- **A `MONGO_URI` with no path makes the driver pick `test`.** `databaseName()`
  falls back to `maddie` instead: a silent write to the wrong database looks
  exactly like a working one.
- **`POST /api/reports` forces `source: "community"`.** It is a public endpoint;
  nothing outside `npm run seed` may write a point marked as example data, and
  nothing may launder an example point into a real one.
- **A configured-but-unreachable database is a 503, not an empty list.** An
  empty crime layer is the one thing on this page that reads as reassurance.
- **`agent: false` does NOT mean "no agent".** It builds a fresh default one,
  so an `options.createConnection` alongside it is never consulted and the
  request opens its own DIRECT connection instead of using the tunnel. On
  loopback that succeeds, so it looks like it works. `requestThrough` passes an
  explicit `http.Agent` whose `createConnection` hands over the socket.
- **`new URL("http://1.2.3.4:80")` leaves `url.port` empty.** Reading the port
  from there silently dropped 472 of the 649 proxies in the list — and left 177,
  so it looked fine. `parseHop` takes the port from the text.
- **An upstream saying no is not the proxy's fault.** A 403 or a 502 from
  OpenStreetMap once marked every exit dead, so one unreachable destination
  emptied the whole pool. `rotate` separates `hop` (transport failed — rest it),
  `limit` (429, this IP — step aside a minute) and `upstream` (nothing to do
  with the proxy).
- **A rotate-worthy status is not any 4xx.** A 400 means the query is wrong;
  asking every proxy in turn the same wrong question burns a slot on each of
  them and still gets a 400.
- **`[[...path]]`, two brackets.** A single-bracket catch-all does not match
  `/api/osm/overpass` itself, and that bare path is where the client POSTs.

## Toolchain constraints

- `npm run check` = `tsc --noEmit && eslint . && node --test "test/**/*.test.ts"`.
  It all runs offline. `test/proxy-chain.test.ts` is the one file that opens
  sockets: it stands up two CONNECT proxies and a TLS server on LOOPBACK, on
  ephemeral ports, and tears them down inside the run. Nothing leaves the
  machine, and it is the only way to prove the double CONNECT actually works.
  Its certificate is `test/fixtures/`, committed and worthless — see the README
  there.
- **A test server holding a CONNECT tunnel must be closed with
  `closeAllConnections()`.** A tunnelled socket belongs to neither end's
  `close()`, so the callback never fires, the test never finishes, and node
  exits with the tests pending — which the runner reports as the tests failing,
  not as a leak.
- Tests run on **Node's type stripping**, no build step. So: **no TypeScript
  parameter properties** (`constructor(readonly x: number)`), no `enum`, no
  `namespace`. Write the field and the assignment out.
- For the same reason, relative imports inside `src/` carry the `.ts` extension
  (`allowImportingTsExtensions`). Components use the `@/` alias, which Next
  resolves and the test runner does not — so anything imported by a test must
  use a relative path.
- `eslint` is pinned to 9.x: `eslint-plugin-react` is not compatible with 10.
- The React Compiler lint rejects a `setState` reached synchronously from an
  effect body. Everything goes inside `void (async () => { … })()`.

## Things that are load-bearing

- **The map is imported with `ssr: false`, from a client component.** Leaflet
  touches `window` at module scope, so it cannot be server-rendered, and
  `next/dynamic` will not disable SSR from a server component.
- **`.map` needs a real height.** A Leaflet container in an auto-height parent
  collapses to nothing, and an invisible map looks like a broken one.
- **Markers are `divIcon`s with inline SVG.** Leaflet's default marker points at
  image files by relative path and every bundler rewrites those paths — that is
  the "my markers are invisible" question.
- **Leaflet's stylesheet loads after `globals.css`**, because it is imported
  inside the dynamic map chunk. Overrides here need to out-specify it; a bare
  `.leaflet-container` rule loses.
- **A blank map says why.** `tileerror` surfaces a message: a background that
  failed to load is not the same as a place with nothing in it.
- **The theme is set by an inline script in `layout.tsx`, before first paint.**
  `localStorage` does not exist during the server render, so a React-only
  version flashes white on every load — on a page people open at night.
  `RoutePlanner` keeps `data-theme` in step afterwards; the two read the same
  key, and changing one means changing the other.
- **Night mode inverts the tiles in CSS** (`.tiles-night`) rather than loading a
  dark basemap. A second tile host is a second thing that can be unreachable,
  and a blank background is the worst failure this page can have.
- **Marker icons are cached at module scope** (`HEARTS` in `MapCanvas`). Leaflet
  compares icons by identity, so a fresh `divIcon` per render tears down and
  rebuilds every marker on the map on every keystroke.
