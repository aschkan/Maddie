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
- `src/lib/daylight.ts` — where the sun is. Day, civil twilight, night — from
  the NOAA solar equations, not from the clock. Pure, tested.
- `src/lib/segments.ts` — the route in ~400 m stretches, each scored by the same
  `assess()` the whole route is. Pure, tested.
- `src/lib/verdict.ts` — how a verdict is written and coloured, in one place.
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
- `src/lib/endpoints.ts` — where the BROWSER asks for the map. This server, by
  default. Pure and tested.
- `scripts/proxies.ts` — `npm run proxies`, the first thing to run on the box.
- `src/app/api/assess/route.ts` — the model endpoint.
- `src/app/api/reports/route.ts` — the crime layer's storage.
- `src/app/api/osm/[service]/[[...path]]/route.ts` — OSM through this server.
- `src/components/BottomSheet.tsx` — the panel, as a sheet with three stops.
- `src/components/TripCard.tsx` — A and B, floating over the map; collapses.
- `src/components/` — the map, the planner, the filters, the comparison, the
  search box, the safety panel.

Tiles, routing, search and the OSM query are asked for by the browser but go
**through this server by default** — `/api/osm/*`, resolved in
`src/lib/endpoints.ts`. That is what makes a proxy configured on the server
reach them at all.

**The API routes each exist for a reason the browser cannot do itself:** the
model cannot be called from the browser (the LAN box is unreachable from a
phone, and the Liara key would be shipped to every visitor), the reports need a
connection string, and `/api/osm/*` is for the deployment whose network cannot
reach OpenStreetMap at all.

## Everything except this app's own API goes through this server

**`README.md` § "Where the browser asks for the map" is the spec, and
`src/lib/endpoints.ts` is the one place that decides.**

The domain answers from TWO machines. One can reach the internet; the other
cannot reach it at all. The same build is deployed to both, and a visitor may
be on a network that reaches neither. Sending the browser straight to
`tile.openstreetmap.org` works on exactly one of those combinations — which is
how the map came to be blank on a site that was otherwise up.

So the four map services resolve to `/api/osm/*` by default, and this server
fetches them: directly where that works, through the entry proxy and the
fastest live exit where it does not. Both machines then behave identically from
the browser's side.

- **This app's OWN API is never forwarded.** `/api/assess` and `/api/reports`
  are same-origin calls to the box that served the page. There is nothing to
  reach around, and putting a proxy chain in front of a loopback call adds two
  hops and a pool of failure modes to something that cannot fail that way.
  `SERVICES` in `osm-forward.ts` is a fixed table holding neither of them, so
  `/api/osm/assess` is a 404; `OWN_API` in `endpoints.ts` says it from the other
  side, and `test/endpoints.test.ts` pins that the two never overlap.
- **`NEXT_PUBLIC_*` must be written out STATICALLY.** `process.env.NEXT_PUBLIC_X`
  is substituted textually at build time; `process.env[name]` is not rewritten
  and arrives in the browser as `undefined`. That is why `endpoints.ts` lists
  the four by hand into a record rather than looking them up by service name —
  a lookup would silently disable every override.
- **`resolve()` is pure and the module-level reads are the only impure part.**
  Order: an explicit `NEXT_PUBLIC_<SERVICE>_URL` (point at your own OSRM), then
  `NEXT_PUBLIC_OSM_DIRECT=1` (browser goes straight out, the old behaviour),
  then the forwarder.
- **A 502 from `/api/osm/*` is THIS SERVER, not OpenStreetMap.** It means
  nothing it tried got out. `forwarderFailure()` turns it into a sentence that
  names the right machine and points at `/api/osm/status`; reporting it as
  "OpenStreetMap answered 502" sends whoever is debugging to the wrong box.
- **The fastest exit is already what the pool hands out.** `rank()` sorts
  known-good first and fastest-first within that, and `sweep()` probes in the
  background so a visitor never waits on a dead proxy to discover it is dead.
  There is nothing to add for "use the fastest one".
- **The honest cost:** every tile now passes through this server. The forwarder
  caches them for a week (`public, max-age=604800, immutable`), and a blank
  basemap is the worst failure this page has.

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

**A dead ENTRY must not condemn the list.** Everything goes through the entry
when one is configured, so an unreachable entry fails every hop with the same
sentence — and the pool used to mark all of them dead and rest them. A real
status page read `total: 649, working: 0, resting: 536` with eight identical
failures, all of them "no TCP connection to 192.168.11.165:2000": hundreds of
proxies blacklisted for a fault none of them had, about a list that had never
been tried. The rules now:

- **`checkEntry()` probes the entry on its own**, one plain TCP connect, before
  each sweep and whenever `/api/osm/status` is read. One answer, about the one
  machine, instead of 649 identical ones about the wrong machines.
- **An entry failure is tagged `stage: "entry"` and never charged to the hop.**
  `isEntryFailure()` is the check. The hop was not contacted, so nothing was
  learned about it — the same rule the pool already applies to an upstream
  saying no, one layer further down.
- **`request.on("error")` must PRESERVE an existing `ChainError`.** It used to
  re-wrap everything as `stage: "request"`, which threw away the only fact the
  caller needed and is why the entry could not be told apart in the first place.
- **With the entry down, the list is used DIRECTLY.** `entryFor()` returns null
  and the hops are tried without it. The entry exists because the exits are
  *assumed* reachable only through it — that is an assumption, and enforcing it
  against a dead entry turns 649 proxies into none. If the exits cannot be
  reached directly either, those attempts fail as they would have anyway.
- **`summary().problem` is one sentence** naming the machine that is actually
  unreachable and what to check. Working it out from `working: 0` was left to
  the reader, and the reader concluded the proxy list was broken.
- **`OSM_PROXY_BUDGET_MS` caps ONE request across all its attempts** (45s).
  Four attempts at a 25-second timeout is a hundred seconds, and a page that
  hangs for a hundred seconds has already failed.

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

## The page is MOBILE FIRST — literally

`globals.css` is written for a **360px phone** and widened with `min-width`
queries. It was a two-column desktop sheet with a single `max-width: 820px`
patch under it, which on a phone gave the panel a 55vh box to scroll inside and
the map whatever was left. **`README.md` § "The page is mobile first" is the
spec.** The rules that will be undone by accident:

- **Every rule starts at phone width.** There is no `max-width` block in the
  stylesheet, and a new one is a sign the rule above it was written for a
  desktop and patched afterwards. The only `min-width` queries are the two at
  the bottom of the file, and they ADD to the rules above rather than undoing
  them.
- **`--tap: 44px`, and nothing interactive is under it.** Including the sheet's
  grab handle and the filter checkboxes — for those the whole `.check` row is
  the target, not the 21px box in the corner of it.
- **16px minimum on inputs.** Anything under it makes iOS Safari zoom the page
  on focus, and it never zooms back.
- **No horizontal scroll.** `overflow-wrap: anywhere` on the body; long values
  wrap rather than widening the page. Addresses and street names are long.
- **The tab bar is at the BOTTOM** below 900px, because the top of a phone
  screen is the hardest place to reach with the hand holding it. Above 900px it
  moves to the top of the sidebar, where the eye starts.
- **`safe-area-inset-*`** on the trip card, the tab bar and the map's buttons.
- **The map is the page.** Everything else floats over it: the trip card at the
  top, the sheet at the bottom, one cluster of map buttons bottom-right where a
  thumb already is. Leaflet's own zoom control is off (`zoomControl={false}`) —
  it lives top-left, which is both unreachable and under the trip card.

### The sheet, and the things that have to move with it

- **Three stops, not free positioning.** `peek` / `half` / `full`. A sheet that
  stays wherever you let go ends up at some useless in-between height, and
  there is no right answer to "where was it last time" on a page opened once a
  week. Tapping the handle cycles; dragging snaps to the nearest.
- **The stops are defined ONCE, in the stylesheet** (`--peek`, `--snap-half`,
  `--snap-full`). `BottomSheet` reads them back with `getComputedStyle` and the
  map's buttons position against them. Three copies of "how far up is half" is
  three places for it to stop being the same number.
- **`data-snap` is on `.app`, not just the sheet.** The map's own buttons and
  the reporting banner have to climb out from under the panel when it opens, and
  they are not inside it.
- **`FitToRoute` measures the furniture rather than assuming it.** The card
  covers the top of the map and the sheet covers the bottom, so fitting into the
  whole viewport hides both ends of the route. It reads the two elements' real
  heights after the sheet has settled — 260ms, because measuring mid-slide fits
  the route into a box that has stopped existing by the time it paints.
- **`touch-action: none` on the grab handle.** Without it the browser claims the
  vertical drag for page scrolling and the sheet never moves.
- **The trip card collapses the moment both ends are set**, and that is the
  point of it: two address fields, two labels and two coordinate readouts is a
  third of a phone screen, permanently, for something touched once.
- **The card is never inside a scrolling container.** The suggestions dropdown
  is `position: absolute` under the input, and a scroll parent clips it.

## The score has two resolutions, and one set of weights

`assess()` scores a whole route. `segmentRoute()` cuts the same per-point reads
into windows of about 400 m and calls **the same `assess()`** on each one, which
is what colours the line on the map and names the dark part of a walk.

- **One scoring function, deliberately.** A second set of weights for stretches
  would be a second opinion about what a lit street is worth, and the two would
  drift until the parts contradicted the whole. `test/segments.test.ts` pins
  that every count on a route is the sum of the counts on its stretches.
- **400 m is set by the evidence, not by taste.** `score.ts` gives the lit
  fraction full weight at about fifteen known samples and `overpass.ts` samples
  every 25 m, so a shorter window cannot carry a lighting reading at all — it
  would swing on two or three points and look sharper for it.
- **`readRoute()` returns the per-point reads alongside the totals, in ONE
  pass.** Matching a point to the street underfoot is the expensive part of this
  whole app; computing it twice would be both slow and a way for the two answers
  to disagree. `computeFacts()` is the thin wrapper for callers that only want
  the totals.
- **Lamps and shops are counted against the nearest sample**, not against the
  route as a whole, because twelve cafes clustered at one end are not frontage
  along the dark middle — and the aggregate could never tell those apart.
- **A stretch the map says nothing about is `unknown` and drawn GREY.** Never
  the red an unlit one gets. "Nobody has mapped this" and "this is dark" are
  different statements, and one of them is not about the street.
- **`worstStretch()` returns null far more often than not, and that is correct.**
  A uniformly mediocre route has no worst part worth pointing at; inventing one
  is the same error `compare.ts` refuses to make between routes, at a grain
  where the evidence is thinner still. `NOTABLE_DROP` is 10 rather than
  `MEANINGFUL_MARGIN`'s 6 for exactly that reason.

## "Dark" is a fact about the sky, not about a clock

**`README.md` § "The safety read" is the spec.** `isAfterDark(hour)` used to be
`hour >= 20 || hour < 6`, and lighting carries four times the weight after dark
as it does by day, so that one line decided verdicts:

- Amsterdam, 22:00 in June — the sun sets at 22:06, and it was scored as night.
- Reykjavik, 23:00 in June — broad daylight, scored as night.
- Tehran, 18:30 in December — ninety minutes past sunset, scored as day.

`daylight.ts` computes the sun's elevation instead, and the rules that will be
undone by accident:

- **Three states, not two.** Civil twilight is its own thing: the sun down but
  under 6° down, where you can still see and lighting has not yet become the
  whole story. Folding dusk into either neighbour is what produced both errors
  above, at opposite ends of the day.
- **The hour is read in the VIEWER's timezone.** `plannedAt()` builds a real
  `Date`, so the platform applies whatever the daylight-saving rules are doing
  this week. That is why `SafetyPanel` sends `at` as an ISO instant and the API
  does not rebuild it: this box's timezone is whatever it was installed with,
  and rebuilding the hour here would answer for a different evening.
- **No point means no sun, and it has to say so.** `sunDeg: null` marks a light
  state that came from the clock rule, the panel prints `(by the clock)`, and no
  sentence about a sunset is produced. Reporting a guess as a computed sunset is
  the failure the field exists to prevent.
- **The polar day and polar night are answers, not errors.** The hour angle is
  an `acos` outside its domain above the Arctic circle; `sunTimes()` reports
  `alwaysUp`/`alwaysDown` rather than letting a NaN print as "Invalid Date"
  under a safety verdict.
- **Every route in a comparison is judged under ONE sky.** `RoutePlanner` passes
  the same point for all of them — two routes judged at different sun elevations
  would differ by something that has nothing to do with the streets.

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
- **Secrets live in this app's own `.env`, in this checkout**, and that is the
  only env file involved. The proxy writes into it and spawns the app with it.
  It used to write to an "orchestrator override" at `env/<name>.env` and merge
  that on top instead, so every shared secret had two homes and a value set in
  one and not the other meant the app and the proxy disagreed — an
  `OPERATOR_KEY` that disagrees answers 401 on every call, which then gets
  blamed on the key. One file, no merge, nothing to keep in step.
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
- **The sun's elevation is not the clock's opinion.** `hour >= 20` called a June
  evening in Amsterdam dark and a December evening in Tehran light, and lighting
  is most of the night score. `test/daylight.test.ts` pins both against the
  almanac.
- **A light state that came from the clock has `sunDeg: null`.** Do not default
  it to a number — null is the only thing separating "the sun was 18° down" from
  "it was gone 8 p.m., so probably".
- **A stretch with no map data must not be drawn like a dark one.** Grey, and
  never the worst stretch. The whole point of `score: null` is that it is not a
  low score.
- **`segmentRoute` and `assess` share one set of weights.** Scoring a window
  with its own formula is how the parts come to disagree with the whole.
- **A new `@media (max-width: …)` block is the bug, not the fix.** The base rule
  it is patching was written for a desktop; rewrite that instead.
- **The sheet's stops live in CSS and are read from it.** Hardcoding 54% in
  `BottomSheet` as well is how the panel and the buttons that dodge it drift
  apart.
- **The React Compiler lint rejects reading a ref during render.** `BottomSheet`
  derives "is this being dragged" from the live height in state instead — a
  render that depends on a ref is a render React did not cause.
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
- **A forwarded path segment must keep its sub-delims.** OSRM takes its
  coordinates as ONE segment, `lon,lat;lon,lat`, and parses that segment itself
  rather than letting a URL library decode it first. `encodeURIComponent` turns
  it into `4.89%2C52.37%3B4.90%2C52.38` and OSRM answers 400 — so forwarded
  tiles and search kept working while routing did not, which reads as "routing
  is broken" rather than as an encoding bug. `safeSegment` encodes only what is
  not `pchar`.
- **`/api/assess` and `/api/reports` are never routed through `/api/osm/*`.**
  Same-origin already; there is nothing to reach around.
- **An unreachable entry proxy is not 649 dead exits.** Tag the stage, check the
  entry on its own, and bypass it rather than blacklisting the list. The
  symptom was `working: 0` about proxies that had never been contacted.
- **Re-wrapping an error loses its stage.** `new ChainError("request", e.message)`
  keeps the words and drops the one bit of structure the caller acts on.

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
