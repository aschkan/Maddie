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
- `src/lib/ai.ts` — local model, Liara fallback. **Server only.**
- `src/app/api/assess/route.ts` — the model endpoint.
- `src/app/api/reports/route.ts` — the crime layer's storage.
- `src/components/` — the map, the planner, the filters, the comparison, the
  search box, the safety panel.

Tiles, routing, search and the OSM query are all fetched by the BROWSER. That
is why a proxy configured on the server does nothing for them, and why a
visitor on a network that cannot reach overpass-api.de sees "could not reach
OpenStreetMap" however the server is configured.

**Two API routes, each for a reason the browser cannot do itself:** the model
cannot be called from the browser (the LAN box is unreachable from a phone, and
the Liara key would be shipped to every visitor), and the reports need a
connection string.

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

## Toolchain constraints

- `npm run check` = `tsc --noEmit && eslint . && node --test "test/**/*.test.ts"`.
  It all runs offline — nothing in the test suite touches the network.
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
