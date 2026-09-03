# Maddie — working notes

A map where you set a start and a destination and it draws the route. Read
`README.md` first; this file is the short list of things that will bite you
while editing.

## Shape of it

- `src/lib/osrm.ts` — build the route request, parse the reply. Pure, tested.
- `src/lib/geocode.ts` — Nominatim search. Pure parser + a fetch wrapper.
- `src/lib/geo.ts` — distance, sampling, bounding boxes. Pure, tested.
- `src/lib/overpass.ts` — the one data source: what OSM says about the streets.
- `src/lib/score.ts` — the verdict. **Deterministic. No model involved.**
- `src/lib/ai.ts` — local model, Liara fallback. **Server only.**
- `src/app/api/assess/route.ts` — the one endpoint.
- `src/components/` — the map, the planner, the search box, the safety panel.

Tiles, routing, search and the OSM query are all fetched by the BROWSER.
**There is exactly one API route, and it exists for one reason:** the model
cannot be called from the browser — the LAN box is unreachable from a phone,
and the Liara key would be shipped to every visitor.

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

## Why OpenStreetMap and not crime figures

Recorded crime is published per neighbourhood per month. A walking route usually
sits inside one neighbourhood, so it gives every candidate route the same number
— it cannot answer the question being asked. OSM changes metre by metre, carries
`lit=*` (what most decides how a street feels after dark, and the one thing you
can act on by walking a different way), and is the same data OSRM routed on.

## Traps — each one has a test

- **OSRM takes lon,lat. Leaflet takes lat,lng.** Swapping them still returns a
  route, just one on the other side of the world. `routeUrl` and `parseRoute`
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
