# Maddie

A women's safety-intelligence platform for the Netherlands.

It answers one question well: **is this place, at this hour, safe for a woman to
go to and come back from?**

Not "is this a good coffee shop". It ranks places and walking routes by street
lighting, who is open, sightlines, how overlooked a street is, what reviewers
said about how staff treat women alone, and what other women have reported —
and it says how confident it is, and why.

| Route | What it does |
|---|---|
| `/` | Safety-ranked place search: "pharmacy", "late food", for a set time |
| `/route` | The safest walking route, scored per segment, not the fastest |
| `/report` | Community reports from women about specific places |
| `/interviews` | Research interviews, geotagged, for the qualitative signal |
| `/guardian` + `/watch/[token]` | A link someone can watch a journey on |

---

## The one rule that matters most

**A gap in what we could see is never reported as a statement about the place.**

If the crime API is unreachable and the app says "no offences recorded nearby",
a woman reads reassurance where the truth is "we did not look". That is the
worst possible failure, and it is silent.

Every signal distinguishes three states and never collapses them:

1. **Measured, and it is fine** — "no offences recorded in this neighbourhood in
   12 months"
2. **Measured, and it is not** — "47 offences, 8 violent"
3. **Not measured** — "No police figures were returned for this neighbourhood.
   That is a gap in the data, not a statement about the place."

In the code this is the `Signal<T>` type in `src/lib/signal.ts`: either
`{ available: true, value, confidence }` or `{ available: false, reason, note }`.
There is no third shape, and no default value that reads like a finding. A
missing dimension scores `null`, never a polite 50 — it lowers the overall
confidence instead.

Four places where this has already bitten, all covered by tests:

- **Crime** — `available: false` with an explicit note when the table returns
  nothing (`test/nl-crime.test.ts`).
- **Places search** — an empty result carries the map-data coverage it was built
  from. "Nothing found here" and "we could not load the map" are opposite claims
  that look identical on a screen (`coverage` in `src/lib/scoring/places.ts`).
- **Geocoding** — a 404 from "no address there" and a 404 from "the geocoder
  timed out" arrive as different statuses (`status: "empty"` vs
  `status: "unavailable"`, HTTP 200 vs 503).
- **Scores** — every dimension carries a confidence, and a missing signal lowers
  it rather than silently scoring neutral (`test/scoring.test.ts`).

---

## Hard constraints

**Netherlands only.** Crime data is national; there is no world feed. `REGION`
decides which source can answer at all. A point outside the envelope is reported
as out of region, never as crime-free.

**No billing relationships required.** The app runs fully with an empty `.env`.
A safety tool that needs a credit card before it can tell a woman whether a
street is lit is a tool most of the people who need it cannot run. A key may
only ever buy a *better* answer, never a working one.

**The server is behind a restrictive network.** Every server-side upstream goes
through one configurable forward-proxy pool, implemented once in
`src/lib/http/fetch.ts`.

**The AI runs locally.** An OpenAI-compatible server on the LAN, first.

---

## Running it

```bash
npm install
cp .env.example .env      # every line is optional
npm run check             # tsc --noEmit && eslint && node --test
npm run dev               # http://127.0.0.1:5007
```

`npm run check` is the gate: type check, lint, and the parser tests. All of it
runs offline.

### Self-host Overpass, from day one

```bash
docker compose up -d
docker compose logs -f overpass    # the import takes a few hours, once
```

Then `OVERPASS_ENDPOINTS=http://127.0.0.1:12345/api/interpreter`.

This is the single biggest lesson from the previous build. The public mirrors
(`overpass-api.de`, `overpass.kumi.systems`, `overpass.osm.ch`) return 429, 502,
504 and twenty-second timeouts continuously, and no amount of client-side
backoff turns a dead mirror into map data. Maddie is NL-only, so it never needs
planet data.

If you must use the public mirrors, all of this is already implemented and stays
mandatory: concurrency 1 process-wide, per-mirror cooldowns (429 → 2 min or
`Retry-After`, 5xx → 30 s, **timeout → 3 min**, the longest), the cooldown
re-checked *after* acquiring a concurrency slot, and one deadline for a whole
tile batch.

---

## Data sources

| What | Where | Key |
|---|---|---|
| Geocoding | `https://api.pdok.nl/bzk/locatieserver/search/v3_1` | none |
| Geocoding fallback | `https://nominatim.openstreetmap.org` | none, 1 req/s |
| Crime | `https://dataderden.cbs.nl/ODataApi/odata` → `47022NED` | none |
| Nuisance | the same, → `47024NED` | none |
| Walking routes | `https://valhalla1.openstreetmap.de/route` | none |
| Map data | **self-hosted** `http://127.0.0.1:12345/api/interpreter` | none |
| Basemap | `https://tiles.openfreemap.org/styles/liberty`, via `/api/map/*` | none |
| Weather | `https://api.open-meteo.com/v1/forecast` | none |
| Timezone | bundled `tz-lookup` — offline, no request | none |
| Street imagery | `https://graph.mapillary.com` | free token |
| Venue reviews | Google Places (New) | billed key |

Only two keys exist, and neither is required:

- **Mapillary** — <https://www.mapillary.com/dashboard/developers> → Client
  Token (`MLY|...`). Free, no card, instant. Feeds the vision pass on lighting
  and sightlines.
- **Google Places** —
  <https://console.cloud.google.com/google/maps-apis/credentials>. Enable
  **Places API (New)** and **Street View Static API** only, and IP-restrict it.
  Needs billing. This is the one capability with no open substitute: review text
  is the only source for "do the staff here step in when a woman is being
  bothered". Without it the signal is reported missing rather than papered over
  with the star rating, which measures the coffee.

### PDOK is first for one reason

It returns the **CBS neighbourhood codes** the police figures are published
against (`buurtcode` / `wijkcode` / `gemeentecode`, resolved most specific
first). Nominatim does not, so a place geocoded through the fallback cannot be
joined to the crime figures at all — and the score says so instead of guessing.

### The crime table

```
Table 47022NED — "Geregistreerde misdrijven; soort misdrijf, wijk, buurt, maandcijfers"
Period coverage 2012–2026, monthly
```

Sibling tables and why they are wrong: `47018NED` is yearly (too coarse in
time); `47013NED` and `47015NED` are per municipality or per place, and one
figure for all of Amsterdam is the same number on the safest street and the
worst one. `47024NED` is *overlast* — nuisance — and is used as a second signal,
because street drinking, loitering and harassment complaints are the things
women actually report and they never reach a crime statistic.

Column names are read from the table's own `DataProperties` rather than
hard-coded: hard-coded columns are how an integration silently starts returning
zero, and zero rows is indistinguishable from zero crime.

```bash
npm run verify:nl-crime                          # search both catalogues
npm run verify:nl-crime -- 47022NED --labels     # prove one table end to end
```

A passing run prints the exact env lines to paste.

---

## Scoring

Eleven dimensions, each returning a score **and a confidence**:

`lighting · footTraffic · openVenues · visibility · refuge · transitAccess ·
guardianship · walkability · incidentHistory · harassmentSignals · environment`

Crime severity weights — sexual offences dominate deliberately:

```
sexual-offence 1.0 · violence-against-person 0.85 · robbery 0.7 ·
public-order 0.45 · drugs 0.3 · theft 0.25 · burglary 0.15 ·
criminal-damage 0.15 · vehicle 0.08 · other 0.1
```

**Point data and area data are structurally different and are not collapsed.**
A UK/US feed gives one row per offence with a fuzzed point; the Dutch figures
give counts per neighbourhood per month per offence type. There is nothing to
plot and nothing to measure a distance to. Inventing points inside a
neighbourhood so the shapes match is fabricating evidence — so `basis` is
carried through, each basis has its own curve in its own units, area data is
carried at lower confidence (0.4 against 0.55), and `totalCount` is carried
separately because `incidents.length` is zero by construction on the area basis.

Rates divide by the months that **actually returned data**, not the months
requested: police figures lag, and dividing by an unfilled window understates
the rate by exactly the length of the lag.

Scores are time-dependent by design. The same street scores 78 at 3pm and 34 at
1am, and that difference is the whole product; every result is computed for an
explicit timestamp the user can change. Darkness is computed offline from the
sunrise equation (`src/lib/scoring/sun.ts`) so "is it dark" never depends on a
network call.

---

## Network and proxies

One setting covers every server-side upstream, implemented once in the HTTP
helper:

- a bare `host:port` is accepted and `http://` assumed — that is how proxies are
  written down, and `ProxyAgent`'s parse error never mentions the missing
  scheme;
- a comma-separated pool, with failover;
- **ranked by trust tier first, latency only within a tier.** A public proxy
  operator sees which hosts this server looks up and when, and for an app that
  reasons about where a woman is at what hour that must not be traded away for a
  600 ms measurement;
- private addresses are **never** proxied — the local AI model lives there, and
  so does the proxy itself;
- a `NO_PROXY`-shaped bypass list, suffix matched: `liara.ir` matches
  `api.liara.ir` and does not match `notliara.ir`;
- probed against **PDOK**, an upstream the app actually depends on, never a
  neutral connectivity endpoint;
- **only transport failures fail over.** An HTTP error is the destination's
  answer, and an aborted request is our own timeout — resting a healthy proxy
  because one upstream was slow empties the pool in a minute;
- undici's own `fetch` with undici's own `ProxyAgent`, from the same copy in
  `node_modules`.

SOCKS proxies are recognised and skipped with a warning: `ProxyAgent` cannot
speak SOCKS, and a silent drop looks like a typo.

---

## AI

Text and vision both run on an OpenAI-compatible server on the LAN (LM Studio,
Ollama, llama.cpp, vLLM), with an optional hosted fallback. That is
architecture, not preference: free per call (which is what makes it affordable
to score forty route segments rather than four), private (this app reasons about
where a woman is, at what hour, alone or not — plus interview transcripts given
in confidence), and impossible to rate-limit or cut off for a billing failure.

The AI tier has its own proxy switch, **defaulted off**: the LAN model is never
proxied by rule, and a reachable hosted endpoint gains nothing from a detour.

Tasks: `infer-location`, `infer-segment`, `street-view-vision`,
`analyse-reviews`, `moderate-report`, `compare-routes`, `analyse-interview`.
Every reply is validated against a Zod schema with one repair lap; the final
result is cached and a failed lap never is.

Moderation fails **open**: a report that could not be reviewed is published and
marked unreviewed, because a model being down must not become a silent censor.

---

## The basemap is served by the app

`/api/map/[...path]`. Every other upstream is fetched server-side so the forward
proxy covers it — but tiles are fetched by the *browser*, and a browser on a
blocked network gets zoom controls, attribution and no ground at all.

Fetching the style through the route is not enough on its own: a MapLibre style
is a document full of absolute URLs, so **every string in the document** is
rewritten, not the three fields that hold URLs today. TileJSON fetched
afterwards comes back through the same route and gets the same treatment.

The upstream host is fixed in code and allowlisted by **origin**, so
`https://tiles.openfreemap.org.evil.test/` does not match; path segments
containing `..` are rejected. The OpenStreetMap attribution is deliberately
excluded from the rewrite — it is a licence obligation, and a blanket URL
rewrite eats it.

---

## Deployment

Behind a Node reverse proxy that owns TLS and :80/:443 and forwards to a
loopback port. The app must not bind :80/:443 itself.

```
domain      maddie.arsaces.ir
appPort     8087        devPort 5007
type        next        (next build on boot, next start)
env file    env/maddie.env
cert        /etc/letsencrypt/live/maddie.arsaces.ir/{fullchain,privkey}.pem
```

Each platform is its own pm2 app (`platform-maddie`), so restarting the proxy
does not restart the sites.

`NEXT_PUBLIC_APP_URL` must be the public https origin, not the loopback port:
guardian share links are absolute, and a link to `127.0.0.1:8087` fails at
exactly the moment someone is relying on it to see where a woman is. `/api/guardian`
detects a loopback origin and says so in the response rather than handing over a
link that will not travel.

Secrets are generated on the box and never copied from a document:

```bash
openssl rand -hex 32   # ANON_HASH_SALT — a known salt makes reporter hashes guessable
openssl rand -hex 32   # ADMIN_TOKEN    — unset means those endpoints refuse everyone
```

Certificates come from certbot manual DNS-01 and do **not** auto-renew; re-run
every ~60 days, and give the proxy group read access to the LE tree plus a
certbot deploy hook.

---

## Acceptance checks

Against a running deployment with open egress:

```bash
# 1. The crime table parses and returns real numbers
npm run verify:nl-crime -- 47022NED --labels
#    Expect: shape resolved, 12/12 months present, rows > 0,
#    categories NOT dominated by "other", roll-up rows excluded.

# 2. Dutch geocoding
curl -s 'https://<host>/api/geocode?lat=52.3728&lng=4.8936'
#    Expect: a real Amsterdam address from PDOK, with buurtcode BU0363....

# 3. The basemap is proxied
curl -s https://<host>/api/map/styles/liberty | head -c 300
#    Expect: "sprite":"/api/map/..." — RELATIVE, not tiles.openfreemap.org.

# 4. A full assessment on the area basis
curl -s -X POST https://<host>/api/safety/point \
  -H 'content-type: application/json' -d '{"lat":52.3728,"lng":4.8936}'
#    Expect: "basis":"area", "totalCount" > 0.

# 5. Outside the region, degrade honestly
curl -s -X POST https://<host>/api/safety/point \
  -H 'content-type: application/json' -d '{"lat":35.6892,"lng":51.3890}'
#    Expect: crime.available false, reason "out-of-region", and a note that
#    says gap in the data. Never "no crime".

# 6. What this deployment can actually see
curl -s https://<host>/api/health
```

---

## Traps — bugs already written once

Each one has a test.

1. **WKT is `POINT(lon lat)`** — longitude first. Reversing puts Amsterdam in
   Somalia. `test/geo.test.ts`
2. **Valhalla polylines are precision 6**, Google's are 5. Decoding at 1e5 lands
   the route in the Gulf of Guinea. `test/geo.test.ts`, `test/sources.test.ts`
3. **Valhalla `summary.length` is kilometres**, not metres. `test/sources.test.ts`
4. **`GeoDetail` does not contain "Dimension"** — a substring test finds the
   period and the offence and silently loses the region. `test/nl-crime.test.ts`
5. **The roll-up row is `Misdrijven, totaal`** — with a comma. A filter for
   `misdrijven totaal` sails past it and every figure roughly doubles.
   `test/nl-crime.test.ts`
6. **StatLine `null` means "not published"**, usually small-number suppression —
   never zero. `test/nl-crime.test.ts`
7. **Month codes are enumerated, never compared with `ge`** — a lexicographic
   range also matches the annual `2025JJ00` codes. `test/nl-crime.test.ts`
8. **Skip the most recent month** — an incomplete month reads as a sudden drop
   in crime. `test/nl-crime.test.ts`
9. **`incidents.length` is not the crime quantity** on the area basis; the array
   is empty by construction. `totalCount` is. `test/nl-crime.test.ts`
10. **A rate limit and a timeout are different failures** — a timeout must still
    rest the upstream, and it never arrives as an HTTP status.
    `test/http.test.ts`
11. **Check a cooldown after acquiring a concurrency slot**, not before queuing:
    most of the wait is behind other tiles. `src/lib/sources/overpass.ts`
12. `process.kill(-pid)` needs `detached: true` on the child, or the group kill
    silently degrades to killing one process. *(No child processes here; kept
    for whoever adds one.)*
13. `process.kill(pid, 0)` succeeds for a zombie — read `/proc/<pid>/stat` to
    tell "running" from "dead but unreaped". *(Same.)*
14. **`navigator.clipboard` does not exist on a non-secure origin** — the copy
    button needs the `execCommand` fallback. `src/lib/client.ts`
15. **`maplibre-gl` has no default export.** Named imports only.
    `src/components/MapView.tsx`
16. **A helper named `useX` trips `react-hooks/rules-of-hooks`** even when it is
    not a hook — predicates are named `xSelected()`. `src/lib/client.ts`

Two more that this build added, both from the toolchain:

17. **Node's type stripping refuses TypeScript parameter properties** — write
    the fields and the assignment out. The tests run on `node --test` with no
    build step, so this is a hard constraint on `src/`, not a style choice.
18. **`new URL()` percent-encodes the braces** in `{z}/{x}/{y}` tile templates
    and drops a default port from a proxy authority. Both are decoded back.
19. **An empty `NEXT_PUBLIC_*` is not a missing one.** Next inlines a blank env
    var as `""` at build time, so `?? DEFAULT` keeps the empty string — while
    `str()` on the server treats blank as absent and returns the default. The
    map read `NEXT_PUBLIC_MAP_STYLE_URL` that way, and since the env file says
    "Leave both blank", the documented setup produced a blank map and a
    `basemap.servedByApp: true` in `/api/health` at the same time. Both sides
    go through `resolveMapStyleUrl()` now. `test/map-proxy.test.ts`

---

## Layout

```
src/lib/config.ts            every env var, parsed once, empty-env safe
src/lib/signal.ts            the three states, as a type
src/lib/cache.ts             TTL cache that never stores a failure
src/lib/http/proxy.ts        pool parsing, trust tiers, bypass matching
src/lib/http/fetch.ts        the one place any upstream is fetched
src/lib/http/limiter.ts      process-wide gates and cooldowns
src/lib/geo/                 WKT, polylines, distance, segmentation
src/lib/sources/             PDOK, Nominatim, StatLine, Valhalla, Overpass,
                             Open-Meteo, Mapillary, Google Places
src/lib/scoring/             sun, OSM reduction, the eleven dimensions,
                             point assessment, route assessment, place search
src/lib/ai/                  local-first client, seven schema-validated tasks
src/lib/store/               Upstash-or-file, and the four repositories
src/lib/map/proxy.ts         style rewriting and the origin allowlist
src/app/api/                 the JSON surface
src/app/                     the five surfaces
scripts/verify-nl-crime.ts   the gate on the crime table
test/                        parsers, against recorded payloads
```

Tests are of the parsers, not the network: those are the failures that are
silent.
