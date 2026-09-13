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
- `src/lib/handoff.ts` — the walk, handed to Google Maps, **with our route as
  waypoints**. This is how navigation happens; there is none in the app. Pure,
  tested.
- `src/lib/verdict.ts` — how a verdict is written and coloured, in one place.
- `src/lib/compare.ts` — which route is preferred, and when to say none is.
- `src/lib/reports.ts` — the crime layer. Entered by people, never scored.
- `src/lib/seed-data.ts` — the example data. **Read its header before touching it.**
- `src/lib/db.ts` — MongoDB, when `MONGO_URI` is set. **Server only.**
- `scripts/seed.ts` — `npm run seed`, which the proxy's reseed button runs.
  **Destructive by default. Read the seed section below.**
- `src/lib/seed-flags.ts` — the flag contract, pure and tested.
- `src/lib/ai.ts` — the one model: Liara, hardcoded, key and all. **Server only.**
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
model cannot be called from the browser (the Liara key would be shipped to every
visitor), the reports need a connection string, and `/api/osm/*` is for the
deployment whose network cannot reach OpenStreetMap at all — and is where a rate
limit is noticed, rotated around, and finally reported.

## There is no environment variable in the proxy system or the model

**`README.md` § "Configuration" is the spec.** Everything that used to be
`OSM_PROXY_*`, `OSM_UPSTREAM_*`, `OSM_CACHE_*`, `NEXT_PUBLIC_*`, `LOCAL_AI_*` and
`LIARA_AI_*` is a constant in the source now. `MONGO_URI` is the only variable
left in this app.

- **Do not reintroduce one.** Two reasons, both already paid for here: this app
  is built once and deployed to TWO machines, so a per-machine setting is
  something the boxes can disagree about with nothing in the repository to say
  which is right; and pm2 replays a saved environment on restart that dotenv
  will not override, so an edited `.env` and a running process can disagree
  indefinitely — it has done, three times, once on `OSM_PROXY_ENTRY`.
- **`NEXT_PUBLIC_*` was worse than the rest**, because it is inlined at BUILD
  time. A value set on a box after the build is a value that silently does
  nothing, which reads as the setting being ignored rather than as a rebuild
  being needed.
- **The seam a test needs is a PARAMETER, not an environment variable.**
  `loadHops({ learned, seed })` takes its files as arguments with hardcoded
  defaults, and `ProxyPool.stateFile` is a field. That is why `resolve()` in
  `endpoints.ts` was already written that way and is worth copying.
- **The AI key is in `src/lib/ai.ts` on purpose and it is a real cost.** Anyone
  who can read the repo can spend it; if it leaks, rotate it in Liara and change
  the constant. Never move it into an env file "for safety" without being asked
  — that is the arrangement this replaced.
- **The model is a CHAT model.** Liara's sample snippet calls
  `openai/text-embedding-3-large`; an embedding model returns vectors and would
  refuse `/chat/completions` on every request, losing the sentence on every read
  while looking configured. `test/safety.test.ts` pins it.

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
- **`resolve()` is pure, and now the WHOLE file is.** Order: an explicit URL for
  the service (point at your own OSRM), then the direct escape hatch (browser
  goes straight out, the old behaviour), then the forwarder. `EXPLICIT` and
  `DIRECT` are constants; they were `NEXT_PUBLIC_*` reads, which are inlined at
  build time and so silently ignore anything set afterwards on the box.
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

The browser asks THIS server, always — that is `FORWARD` in `endpoints.ts` and
it is the shipped default. The server goes out directly where that works, and
otherwise through `ENTRY_PROXY` (null by default) → one of the pool →
OpenStreetMap. Two plain HTTP proxies means two stacked `CONNECT`s with TLS on
top; see the header of `proxy-chain.ts`.

**The entry proxy is never the exit.** It is the way in to the second hop and
nothing else — that was the requirement, and it is also what keeps this
server's map queries out of the LAN proxy's logs. `test/proxy-chain.test.ts`
asserts the ORDER of the two CONNECTs for exactly that reason.

**Each machine finds and keeps its OWN proxies.** The domain answers from two
servers with different egress — that is the whole reason any of this exists —
so a proxy proven from one is not evidence about the other. `proxies.json` is
a committed SEED, the same file on both; `.data/proxies.json` is what this
machine learned, gitignored and per checkout. `loadHops()` reads the learned
list first and the seed after. Never write findings back into the committed
file: the two servers would overwrite each other's answers, and the one that can
reach the internet would teach the one that cannot.

**The server scrapes on its own, from the GitHub lists in `proxy-sources.ts`.**
`refill()` is `npm run proxies -- --scrape --save` run by the server itself, from
`sweep()`, gated two ways: not above `MIN_WORKING`, and not more often than the
refill interval — an hour normally, five minutes below `STARVING`. Only the
exits that answered are kept — a list of thousands costs a timeout apiece on
every boot to rediscover that they are dead, which is what the 649-entry file
was doing. When this box cannot reach GitHub either, the sources are fetched
THROUGH an exit that already works.

- **The `directWorks` gate is GONE, and putting it back breaks the rate-limit
  path.** It used to skip the scrape entirely on a machine that could reach
  OpenStreetMap by itself. That was right while the proxies were only about
  reachability; they are also how a rate limit is got around now, and a rate
  limit lands on precisely the machine that CAN reach OpenStreetMap — its own IP
  is the one that has used up its share.
- **`start()` runs on an empty list too.** It used to return early there, which
  made "no proxies yet" permanent on a fresh checkout: nothing swept, so nothing
  scraped, so the list stayed empty.
- **`MIN_WORKING` is 24, and the appetite is deliberate.** A long route is split
  many ways, each piece may rotate through several exits, and a rate-limited one
  rests for a minute — so the cooldown only works with a deep bench behind it.
  `SCRAPE_MAX` is 1500 a round, probed `SCRAPE_CONCURRENCY` (150) at a time,
  from seventeen lists. Lowering any of these re-creates the starvation that
  made a route read fail while three good exits were mid-request.

**A rate limit going out DIRECTLY must rotate, not be returned.** The
direct-first path returned whatever came back, a 429 included — so on the
machine where `directOk` is true every request went straight out, the limit
came straight back, and the exits were never consulted. `shouldRotate()` is
checked on that path too now. A per-IP limit is precisely when a different
exit is worth having.

**The layer bbox is SNAPPED onto a grid, and that is what stops the rate
limit.** It went into the query at five decimal places — a metre — so every
drag of a single pixel was a different query string: a different question to
Overpass, a different cache key, another of the two slots it hands out per IP.
`snapBox`/`gridStep` round the visible box outward onto a six-cells-across
grid, so a pan inside one cell asks the question already answered. Measured
over sixty small pans: 60 distinct queries before, 9 after. `RoutePlanner`
also keeps the last question asked and skips the fetch outright when it has
not changed, and backs off for a minute when Overpass says it is limiting us
— retrying into a limit on every pan is what holds it open, and each of those
attempts spends the slot the route read needs.

**The cache is the lever, not the exit list.** `osm-cache.ts` holds what was
already fetched: ten minutes for an Overpass query (the layer query re-runs on
every pan that settles, and panning back to where you were is the commonest
thing anyone does on a map), an hour for an address search, a week for a tile.
An answer served from memory is a request that was never made, which is a
better answer to "we are over the limit" than making the same request from
somewhere else. It is bounded by bytes with least-recently-used eviction —
an unbounded cache on a long-lived server is a memory leak with a nice name —
and **a 429 or a 5xx is never stored**, because caching a refusal for ten
minutes turns one into ten minutes of them.

**Direct first, when direct has been shown to work.** `checkDirect()` probes
it on every sweep and the forwarder uses it only when `directWorks` is true.
The two machines this is deployed on differ in exactly this: the one with
working internet must not send every tile through a public proxy, and the one
without must not spend a timeout per request rediscovering that it is blocked.
A probe that has not run yet counts as "no", for the second reason.

**`proxies.json` holds proxies known to WORK, not everything a scrape found.**
It held 649 scraped entries; a full sweep put every one at dead, and probing
them cost minutes of each boot to learn it again — while the status page
reported `total: 649` as though that were reassuring. `npm run proxies`
re-probes.

**`ENTRY_PROXY` is null, is rarely needed, and is not the normal arrangement.**
It is only for a network where the proxies in the list are reachable solely
through another one. Do not write a specific LAN address into this repo as
though it were the default — it was, and when that machine went away every
example, the scraper's help text and the failure message pointed at a box that
no longer existed.

**A dead ENTRY must not condemn the list.** Everything goes through the entry
when one is configured, so an unreachable entry fails every hop with the same
sentence — and the pool used to mark all of them dead and rest them. A real
status page read `total: 649, working: 0, resting: 536` with eight identical
failures, all of them "no TCP connection to <the entry proxy>": hundreds of
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
- **`BUDGET_MS` caps ONE request across all its attempts** (45s). Four attempts
  at a 25-second timeout is a hundred seconds, and a page that hangs for a
  hundred seconds has already failed.

The upstream comes from a fixed table in `osm-forward.ts` and can never be
named by the request. A forwarder whose target is a query parameter is an open
proxy, and an open proxy on a public server is somebody's problem within a day.

## A route read is four queries at once, through four different exits

**`README.md` § "A route read is several queries, going out at once" is the
spec.** `chunkPath` in `overpass.ts` cuts the route; `fetchFacts` fires the
pieces with `Promise.all`; `rank()` in `proxy-pool.ts` is what hands each piece
a different exit, by skipping a hop that is already in flight.

It used to be one query, deliberately, because parallel queries earn a 429.
That reasoning holds only while every query leaves from the same IP — and it
stopped being true when the forwarder grew a pool. Four quarters through four
exits are one query per IP, not four.

The rules that will be undone by accident:

- **The pieces SHARE their boundary vertex.** `around:` matches within a radius
  of the polyline, so two corridors that share an endpoint join with no gap.
  Trimming that "duplicate" point leaves an unqueried notch in the middle of the
  route: no ways under it, every sample reads `lit: "unknown"`, and the map
  draws it grey with "nobody has mapped this" — a claim about OpenStreetMap that
  would be false. `test/overpass-parallel.test.ts` reassembles the pieces and
  asserts they are the original path.
- **The replies are DEDUPLICATED by `type/id`.** The shared vertex means two
  pieces return the same ways and lamps. Counting one twice makes the score
  depend on where the cut fell, which is an implementation detail and must not
  be visible in the answer.
- **`readRoute` still runs ONCE, over the whole path.** The split is about how
  the elements are fetched, never about how they are counted — a per-piece count
  summed afterwards would be a second implementation of the scoring, and
  `test/overpass-parallel.test.ts` pins that a split read equals an unsplit one.
- **A piece that fails is ASKED AGAIN — only then does the read fail.**
  `PIECE_ROUNDS` (3) re-asks just the pieces that did not come back; the ones
  that did are never re-fetched. Leaving this out was a shipped bug: a 16 km
  walk cut seven ways failed as a whole because ONE piece got a 502, while the
  other six sat read and discarded. A piece goes out through a public proxy and
  a public proxy fails often — at a per-piece success rate that looks fine, a
  seven-way split does not.
- **One missing piece still fails the WHOLE read, once the retries are spent.**
  Answering for six sevenths and reporting the seventh as unmapped is the
  grey-notch failure again, arrived at from the other direction. Retrying is the
  fix; salvaging a partial read is not.
- **A rate limit is NOT retried.** A 429 means the server already rotated
  through every exit it has, so asking again a moment later asks the same
  exhausted pool the same question and holds the limit open while the reader
  waits. It ends the read at once, with the sentence that has an action in it.
- **`READ_BUDGET_MS` (60s) caps the whole read, retries included.** The server
  already caps ONE request at 45s; three rounds of that is over two minutes, and
  a page that spins for two minutes has already failed — the person reloads,
  which starts again and takes another set of exits with it. The first round
  always runs, or the read would report a failure it never had.
- **Under `CHUNK_MIN_M` (1.5 km) there is no split.** Four queries to answer
  what one answers as fast is four slots spent for nothing.
- **DIRECT is one exit, and it is COUNTED.** `takeDirect()`/`releaseDirect()`
  cap it at `DIRECT_CONCURRENCY`. The forwarder reaches for direct first
  whenever it works, so untracked, every piece of a parallel read left from this
  server's single IP at once — the per-IP limit the split exists to get under,
  arrived at from the inside. Pieces that cannot have the lane go straight to a
  proxy, which is what the pool is for.
- **The mirror list must cover `DIRECT_CONCURRENCY`, NOT `MAX_CHUNKS`.** Proxied
  pieces each have their own IP and may share a mirror freely; only the ones
  leaving directly need different hosts to stay apart.
- **The pool is GROWN, not the ambition trimmed.** `MIN_WORKING` is 24,
  `SCRAPE_MAX` is 1500 probed 150 at a time from seventeen lists, and below
  `STARVING` (6) the refill interval drops from an hour to five minutes. A long
  route split many ways wants dozens of exits at once and a rate-limited one
  rests for a minute, so the cooldown only works if there is a deep bench behind
  it. Shrinking the split is the fallback, not the plan.
- **The split is SIZED to the route AND to the pool, never fixed.**
  `piecesForRoute()` takes the smaller of two numbers: length says how many
  pieces the walk warrants (`CHUNK_TARGET_M`, about 2.5 km apiece, ceiling
  `MAX_CHUNKS` = 12), and `x-osm-exits` — reported by the forwarder on every
  reply and halved by `piecesFor()` — says how many can be in the air.
  The halving is not caution: a piece is not one request, it rotates up to
  `MAX_ATTEMPTS` times, so a split as wide as the pool oversubscribes it and the
  unlucky piece spends every attempt on dead proxies — and one missing piece
  fails the whole read by design. Both numbers were learned from a live status
  page reading `working: 4, resting: 19`. Never restore a fixed chunk count.
  `test/overpass-parallel.test.ts` pins all of it.
- **Routes are still read one at a time.** Parallel WITHIN a route, sequential
  BETWEEN them: three routes at once would be twelve requests in the air.

## A rate limit is said out loud, after the rotating has failed

**`README.md` § "When the rate limit is reached, the page says so" is the spec.**

- **The forwarder answers 429, never 502, when every exit was rate limited.**
  `rotate()` returns `limited: true` for it. They are different failures: 502
  says this server could not get out and sends whoever is debugging at the proxy
  list, which just did its job four times.
- **The 429 body carries `exitsTried`**, and `rateLimitMessage()` in
  `endpoints.ts` turns it into the sentence the page shows. "We are being rate
  limited" is a guess; "we tried 4 different exits and each was refused" is an
  explanation, and it is the difference between the reader waiting and the
  reader understanding.
- **Rotate first, then say it.** Both halves are load-bearing. Saying it without
  rotating makes the pool pointless; rotating without saying it leaves the page
  spinning with nothing left to try.
- **`nothingWorked()` decides which of the two it was, and all three sources
  count.** A 429 seen only by the DIRECT attempt is still a rate limit. Dropping
  it is what shipped the bug: with an empty pool `rotate()` returns having tried
  nothing, so `limited` is false, and the reply became the 502 for "no route out
  worked" on a server whose network was fine.
- **A request waits for a BUSY exit but never for a RESTING one.**
  `waitForExit()` returns the moment nothing is in flight, because everything
  left is then resting out a cooldown — and waiting for a cooldown to expire so
  the same request can retry the hop is precisely the retry the cooldown exists
  to prevent. The first version of this spent the whole 45s budget on a proxy
  already known to be dead.
- **A rate limit outranks any other failure in the batch.** It is the temporary
  one, the one that is nobody's fault, and the only one with an action attached.
  Reporting a neighbouring chunk's 502 instead sends the reader to check a
  server that is fine.
- **The 429 is NEVER cached.** `keep()` is deliberately not called on that path,
  and `osm-cache.ts` refuses a non-200 anyway — storing a refusal for the
  service's TTL turns one minute of rate limiting into ten.

## The split that matters

**Code computes the score. The model writes the sentence.**

A model asked to invent a safety number produces a confident number with
nothing behind it, and this is not a subject to be confidently wrong about. So
`score.ts` turns counts into a verdict, and the model is handed those numbers
and asked to explain them. If the model does not answer, the page still shows
the score and the findings — only the prose is lost. There is no second tier to
fall back to any more, which makes that degradation the whole error path rather
than an unlikely one: it has to stay quiet and complete.

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

## The box this runs on — the platform reverse proxy

This app does not run alone. It is one of nine platforms on a pair of servers
sitting behind the [platform reverse proxy][proxy-repo], which owns :443, routes
by hostname, and owns this app's process. **Read that repo's `README.md` and
`CLAUDE.md` before changing anything about how this app boots, reads
configuration, or talks to its database** — most of what looks like a local
choice here is actually a contract with that system.

[proxy-repo]: https://github.com/aschkan/platform-reverse-proxy

### Where this app sits

- It listens on **plain HTTP on 127.0.0.1:8087**. TLS is terminated by the proxy
  in front of it. Never bind `0.0.0.0`, and never take :443 — that port belongs to
  the proxy, and whichever process loses the race takes *every* site on the box
  down with it, not just this one.
- It runs under pm2 as **`platform-maddie`**. That name is how the proxy finds and
  adopts it; renaming it gives two processes fighting over one port, each
  invisible to the other.
- The proxy passes the **original `Host`** through untouched. Tenant-subdomain
  logic depends on it.
- Its public name is **`maddie.arsaces.ir`**, and the certificate for it (and its
  wildcard) is issued by the panel's 🔒 SSL button, not by anything here.

### The contract: this app's entry in `platforms.json`

That file, in the proxy repo, is the single source of truth for what runs on the
box. This app's entry declares:

- `"serverDir": "."` — the app lives in the repo root. Every `npm` command the
  panel runs, and the `.env` it reads, are resolved from there.
- `"appPort": 8087` — the loopback port. It is forced into the environment at
  launch, so the app must read it rather than hardcode one.
- `"domain": "maddie.arsaces.ir"` — what the proxy routes to this app.
- `"secrets": []` — declared NONE, and the empty array is the declaration.
  Never-declared (`secrets` absent) means "nobody has looked yet" and reads
  differently in the panel. Do not "tidy" the empty array away.
- No `"operator"` key — this app does not serve `/api/operator/*`, so the panel
  REFUSES to write it an `OPERATOR_KEY` rather than leaving a key nothing reads.

A change in this app that needs a new variable, a new port, or a new domain is a
change to that file too. It is not optional and nothing here will tell you.

### How it is started

`"type": "next"`, so the proxy runs this app's OWN
`node_modules/next/dist/bin/next start -p 8087 -H 127.0.0.1`. It does not use
`package.json` "start" — those scripts routinely hardcode a dev port. It also sets
`PORT` and `HOSTNAME` so anything reading those agrees with the bound port, and it
refuses to start at all without a `.next` build.

The environment it gets is built **fresh from this checkout's own `.env`** at
`platforms/maddie/.env`, plus four values the proxy forces:
`NODE_ENV=production`, `BEHIND_PROXY=true`, `APP_PORT`, `HOST=127.0.0.1`.

There is **one env file** and it is this app's own. There used to be a second
"orchestrator override" merged on top at spawn time, which meant every shared
value had two homes and a value set in one and not the other put the app and the
proxy into permanent disagreement. Do not reintroduce a second layer.
- **The env file is now nearly empty, and `MONGO_URI` is the only thing in it
  this app reads.** The proxy system, the map upstreams and the model are
  constants in the source — see § "There is no environment variable" above. So
  changing any of those is a code edit and a **rebuild** (the panel's Update
  button), not an env-editor save and a restart. The order is always
  edit → build → run.

### The buttons, and exactly what each one runs here

| button | what it does to this app |
|---|---|
| **Start** | clone if needed → install → build → run under pm2 |
| **Update** | `git pull` + reinstall + rebuild + restart |
| **🔑 Fix secrets** | generates only the keys declared above, into this checkout's `.env`, **filling in and never rotating** |
| **💣 Reseed DB** | `npm run seed -- --force` in the repo root, with this `.env` merged in |
| **🔒 SSL** | Let's Encrypt over DNS-01 for `maddie.arsaces.ir` — a human publishes the TXT records |
| **env editor** | edits `platforms/maddie/.env` and restarts this app |
| **⚙ Apply example env** | replaces that file with `.env.example` wholesale (keeps `.env.bak`) |

Two of those have hurt this deployment and are worth knowing before you press
them. **💣 Reseed DB is destructive by default** — `--force` beats every keep
flag and every `SEED_*` env var, which is the whole point of one button meaning
one thing everywhere. And **⚙ Apply example env replaces host-specific values
with the generic defaults in `.env.example`**, including the database URI; it now
reports which values it changed, but the example file is not a safe thing to
apply to a live box without reading that report.

### Two servers, and what that means for this app

Both servers answer for every domain, and **every DNS name resolves to both
IPs**. So this app runs twice, once per box, and the two copies must agree:

| what | how it is shared |
|---|---|
| code + configuration | the panel's mirror — a Start/Stop/Restart/Update or env save fans out to both |
| the database | one MongoDB replica set spanning both boxes, over a TCP tunnel the proxy runs in-process |
| uploaded files | `scripts/sync-uploads.sh` on the proxy — push and pull, never `--delete` |
| certificates | rsync from one issuing box to the other, plus an hourly timer |
| taking over | `lib/failover.js` promotes the survivor when the other box is really gone |

The one that reaches into this repo:

- **`MONGO_URI` must name BOTH members and the replica set**, e.g.
  `mongodb://parsa.rs:27017,aschkan.rs:27017/maddie?replicaSet=rs0`. The driver then
  finds the primary and follows it when it moves, so this app keeps writing
  correctly through a failover with no restart.
- **A single `127.0.0.1` host is the failure to watch for.** It connects, it
  starts, it serves — and each box quietly writes to its own copy, which is
  exactly the split the replica set exists to end. It has happened here twice.
  `scripts/set-mongo-uri.js` in the proxy repo rewrites all nine platforms and
  reports any that are wrong; the panel's Servers tab flags them per machine.
- **Never drop the database name** from the URI. Without it the driver picks
  `test`, and the app connects and serves an empty site.

### Traps that have actually bitten this system

- **pm2 replays a saved environment, and dotenv will not override what is
  already set.** Editing `.env` and running `pm2 restart` — even with
  `--update-env`, which re-reads the *shell's* environment and not the file —
  can leave the process running the old value indefinitely, with the file in
  front of you saying something else. It has done this three times here
  (`ADMIN_PASS`, `MONGO_URI`, `OSM_PROXY_ENTRY`). The fix is
  `pm2 delete platform-maddie` so the dump forgets it, then Start from the panel.
  The platform card now shows **⚠ n env key(s) stale in the process** when it
  happens.
- **Redis is never required.** Nothing in this app's seed, build or boot may
  depend on a cache server being up — that rule holds across every platform on
  the box. Using one for caching is fine; needing one is not.
- **The seed contract is owned by the proxy repo**, not by this one. Read
  README § "The seed contract" there before changing this app's seed.
- **Secrets are filled in, never rotated.** A regenerated signing key logs every
  user out at once; a regenerated encryption key makes stored data permanently
  unreadable.

### Where to read more

Everything above is the short version. In the proxy repo:

- `README.md` § **"Both servers live"** — the five kinds of shared state, how a
  real failure plays out, and the commands that verify the whole thing.
- `README.md` § **"The seed contract"** — what `npm run seed` must do here.
- `README.md` § **"How secrets work"** and § **"SSL"** — the specs for both.
- `CLAUDE.md` — the same list of traps, from the proxy's side.

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

## Navigation is handed to Google Maps, and the ROUTE goes with it

`handoff.ts` builds a Maps link that starts turn-by-turn. There is deliberately
no navigation view in this app: spoken directions, rerouting, a lock screen and
somebody else's battery budget are not worth rebuilding, and a person walking
home at night is better served by the app they already know.

There WAS one — MapLibre, tilted, heading-up, the lot — and it was removed. If
it is ever wanted back, git history is the place to get it rather than a fresh
attempt; it took three goes to stop it rendering blank.

- **A link to the destination is not a handoff of the route, it is a handoff of
  the problem** — to the router this app exists to disagree with. Google plans
  the fastest way; ours is the one worth walking. So our route travels as
  waypoints, and that is the whole point of the feature.
- **`MAX_WAYPOINTS` is 9 and is not a number to tune.** It is the documented
  ceiling of the Maps URLs API, and over it the link is rejected outright —
  navigation does not start at all, rather than starting slightly wrong.
- **The budget is spent by Douglas–Peucker, never by even spacing.** Even
  spacing spends it on long straights, where Google would go the same way
  unprompted, and has nothing left for the corner where our route and the fast
  route part company — the only place a waypoint does any work.
- **`driftM` is reported rather than hidden.** Nine points approximate a route,
  they do not reproduce it, and the panel says how much shape was lost.
- **The `|` between waypoints must not be percent-encoded by
  `URLSearchParams`** — Google ignores the encoded form and quietly reverts to
  its own route, which looks exactly like the feature working.
- **The safety read does not travel**, and the button says so before it is
  tapped. The lit stretches and the stretch worth taking care on are the reason
  to have planned here, and they stay here.
- **`steps` is NOT asked of OSRM.** Nothing reads turn instructions any more —
  Google plans its own turns from the waypoints — and asking would grow every
  reply to carry something unread, through a pool of public proxies.

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
- **Routes are read one at a time — but ONE route is read in several parallel
  pieces.** Those are not in tension: Overpass's limit is per IP, so pieces
  through different exits are one query each, while three whole routes at once
  would need three times as many exits. Parallel within, serial between.
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
- **The direct path must check `shouldRotate` too.** Returning a 429 from it
  makes the whole proxy list dead weight on exactly the machine that can reach
  OpenStreetMap but has used up its share of it.
- **Never cache a non-200.** A stored 429 turns one refusal into a TTL's worth
  of them, and a stored 500 turns a blip into an outage.
- **A bbox at five decimal places is a cache that never hits.** Snap it, or
  every pan is a fresh query to a service that allows two at a time.
- **The probe is Overpass, not a generic connectivity check.** A list where 28
  proxies passed an `api.ipify.org` test had 3 that could fetch Overpass, and
  two of the failures were proxies intercepting TLS — which an ipify check
  over the same intercepted connection is perfectly happy with.
- **Chunks that do not share their boundary vertex leave a grey notch.** The gap
  has no ways under it, so it reads as unmapped rather than as unasked. The two
  statements are not the same and only one of them is about the street.
- **Deduplicate the merged elements, or the score moves with the cut.** Adjacent
  corridors overlap; a lamp beside a boundary is returned twice.
- **A 429 that every exit gave is a 429 to the client, not a 502.** And it says
  how many exits were spent. Anything vaguer leaves the reader debugging a proxy
  list that is working.
- **An embedding model cannot write the sentence.** `openai/text-embedding-3-large`
  is what Liara's sample snippet uses and it would 400 on `/chat/completions`
  every time, so the page would silently lose its prose while looking configured.
- **There is no environment variable to add.** The proxy system, the upstreams
  and the model are constants; `MONGO_URI` is the only one left. A test that
  needs to vary one takes a parameter.
- **A Google Maps link to the destination is not a handoff of the route.** It
  is a handoff of the problem, to the router this app exists to disagree with.

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
- **A blank map looks identical whatever caused it.** When this app briefly
  grew a second map renderer it shipped blank twice, and both times a screenshot
  of the blank map was looked at and explained away. If anything here ever draws
  to a canvas again, measure the pixels of a COMPOSITED screenshot —
  `readPixels` on a WebGL canvas without `preserveDrawingBuffer` reads back
  cleared and reports every map as blank, which is the false negative that hides
  the bug.
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
