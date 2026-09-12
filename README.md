# Maddie

Set a start and a destination, compare the ways round, and see what
OpenStreetMap actually records about each one.

![Leaflet + OpenStreetMap](https://img.shields.io/badge/map-Leaflet%20%2B%20OpenStreetMap-7c5cff)

- **Click the map** to drop **A**, then **B** — or type an address and pick a
  suggestion. Drag either pin to move it and the routes follow.
- **Compare the alternatives.** Each way round is read from the map and scored;
  one may be marked **Preferred**. Never "safe" — see below.
- **Layers**: safe spots (pink hearts), lighting (yellow), and a crime layer
  whose data is not what you would expect it to be.
- **Light and night mode**, remembered between visits.
- **Drive, walk or cycle**, with distance and travel time.
- **No API keys.** Nothing to sign up for, nothing to bill.

## Running it

```bash
npm install
npm run dev        # http://127.0.0.1:5007
```

```bash
npm run build && npm run start
npm run check      # typecheck, lint, and 146 tests — all offline
```

## The safety read

With a route on screen, the page reads the streets it runs along and says how
they look at the hour you set.

**One data source: OpenStreetMap.** Not recorded crime — that is published per
neighbourhood per month, and a walking route usually sits inside a single
neighbourhood, so it hands every candidate route the same number and cannot
answer "which of these two streets". OSM changes metre by metre, carries `lit=*`
(what most decides how a street feels after dark), and is the same data the
route was planned on.

**The score is computed in code; the model writes the sentence.** Lit and unlit
samples, street lamps, frontage, parkland, tunnels — counted from the map, in
`src/lib/score.ts`, where anyone can check them. A small local model asked to
invent a safety number would produce a confident one with nothing behind it.

**"Unknown" is never "fine".** Most streets in most of the world carry no `lit`
tag, and an unlit street and an unmapped one look identical in the data. When
coverage is too thin the page says so and shows no score at all, rather than a
reassuring number drawn from an empty map.

## "Preferred", not "safe"

With two or three ways round on screen, each is read from OpenStreetMap and
scored, and the best of them may get a **Preferred** badge. The word is the
whole claim: what the map supports is *this one is better lit and has more open
frontage than that one*, which is much smaller than a promise about safety, and
the label has to match the claim.

The other half of that is refusing to pick. Two routes scoring 61 and 63 are the
same route as far as this data is concerned, so nothing is badged — see
`MEANINGFUL_MARGIN` in `src/lib/compare.ts`. A route the map says too little
about is never preferred by default, and never dismissed by default either.

## The layers

Switched on in the filter panel, drawn over whatever is on screen. All of it is
one Overpass query, debounced until the map stops moving, and only at zoom 14 or
closer — the area below that is too big to ask about.

**Safe spots — pink hearts.** Taxi ranks, police, hospitals, fire stations, 24/7
gyms, shopping centres, supermarkets, petrol stations, bars and cafés,
libraries, pharmacies, pedestrianised streets, stations. Somewhere with a door,
a light and usually a person: places to walk *towards*, not places guaranteed to
help. Opening hours are shown exactly as OpenStreetMap holds them and are not
interpreted — only `24/7` is read, because it is the one value with no room for
a wrong reading, and a confident "open now" that sends someone to a locked door
at 2 a.m. is the harm to avoid.

**Lighting — yellow.** Streets tagged `lit=yes` as lines, individual
`highway=street_lamp` nodes as dots. An unmarked street is one nobody has
surveyed, not a dark one.

**Crime — purple.** There is no open dataset of where harassment, catcalling,
sexual assault or rape happened. Police forces publish counts per neighbourhood
per month, which cannot tell one street from the next one over, and the
categories that matter most here are the least likely to have been reported at
all. Drawing purple dots from a national statistics table would make this layer
look like it answers the question, so it does not: the layer holds **reports
entered by the people using it**, starting empty. It never touches the route
score. An empty map means nothing was written down — which is not the same as
nothing having happened, and the panel says so rather than leaving the blank
space to be read as reassurance.

Where those reports live depends on `MONGO_URI`. Set, they are rows in the
`maddie` database and everyone on the instance sees them; unset, they stay in
the browser that entered them. The panel prints which, because a report somebody
believed they had filed, visible to nobody, is worse than not being able to file
one.

## When the browser cannot reach OpenStreetMap

Tiles, routing, search and Overpass are normally fetched **by the browser**,
which is why a proxy on the server does nothing for them. Set these and they go
out through the server instead — no code changes, the base URL is just local:

```bash
NEXT_PUBLIC_TILE_URL=/api/osm/tile/{z}/{x}/{y}.png
NEXT_PUBLIC_OSRM_URL=/api/osm/osrm
NEXT_PUBLIC_NOMINATIM_URL=/api/osm/nominatim
NEXT_PUBLIC_OVERPASS_URL=/api/osm/overpass
```

The upstream for each is fixed in a table in `src/lib/osm-forward.ts` and cannot
be named by the request — a forwarder whose target comes from a query parameter
is an open proxy.

### Two proxies in a row

For a server whose own internet is filtered, where one proxy is reachable and
the proxies that can actually get out are only reachable *through* it:

```
browser → this server → OSM_PROXY_ENTRY → one of OSM_PROXY_LIST → OpenStreetMap
```

```bash
OSM_PROXY_ENTRY=192.168.11.165:2000
OSM_PROXY_LIST_FILE=proxies.json      # the default; a scraper's JSON is fine
```

The entry proxy is never the exit on its own — it is the way in to the second
hop and nothing else. Both are plain HTTP proxies, so this is two `CONNECT`s
stacked with TLS on top; `src/lib/proxy-chain.ts` has the detail and the tests
stand up two real proxies on loopback to prove it.

The list is probed in the background — the real chain, to a real upstream — and
ranked working-first, fastest-first, with a failing hop resting for longer each
consecutive time. Nothing trusts the list's own metadata: the 649-entry list
this was built for claims `https: false` for every entry, which taken literally
would mean not one can tunnel.

```bash
npm run proxies            # probe them all now and print what works
npm run proxies -- --all   # including the dead ones and why
```

`GET /api/osm/status` says the same thing on the running app, and every
forwarded reply carries `x-osm-via` (which exit answered) and `x-osm-attempts`.

**If everything fails with `refused with 403`, the list is fine and the entry
proxy is the problem.** A Squid-style proxy allows `CONNECT` to port 443 and
nothing else out of the box, and these hops are on 8080, 999, 3128. Both
`npm run proxies` and `/api/osm/status` call that case out by name.

### On rotating exits and rate limits

A request that comes back rate limited is retried from a different exit and a
different mirror, because that is the only way to get an answer on a network
that cannot reach the mirrors directly. It is deliberately not a way to take
more from Overpass than they offer: `OSM_PROXY_ATTEMPTS` is 4, requests are
serialised, and every one identifies itself with a real `User-Agent`.

**The actual fix is to self-host Overpass** — a Netherlands extract is a
`docker compose up` — which removes the rate limit and the reachability problem
in one move, and is faster than any of this. Point
`OSM_UPSTREAM_OVERPASS` at it and the chain has nothing left to do.

## Example data — `npm run seed`

```bash
npm run seed                # WIPE the database, then write the example reports
npm run seed -- --force     # the panel's button: wipe and rewrite, no switch honoured
npm run seed -- --keep      # keep every report a person typed; replace only the examples
npm run seed -- --no-demo   # wipe and write nothing (`--clear` still works)
npm run seed -- --count=400 --days=90 --seed=7
```

**It is destructive by default, and on this app that has a specific cost.** The
reports collection holds things people typed about being followed, harassed or
assaulted, and there is no other copy of them. `--keep` is the switch that
spares them — reach for it on anything that is not a fresh box.

That default is not a local choice. Every platform behind the reverse proxy
answers the same `npm run seed -- --force` from the same 💣 Reseed DB button,
and the contract they all keep is written down in that repo's README under
[The seed contract](https://github.com/aschkan/platform-reverse-proxy#the-seed-contract--what-a-platforms-npm-run-seed-must-do).
`--force` beats `--keep`, `--no-demo` and every `SEED_*` an env file might be
carrying, because an operator who presses that button should not have to reason
about a file they have never read — `src/lib/seed-flags.ts` is that rule as one
pure function, and `test/seed-flags.test.ts` pins it without touching a database.

The wipe is `dropDatabase()`, with an inventory of what was there logged before
it goes; the indexes `reportsCollection()` owns are rebuilt straight afterwards.
The example reports are generated **before** anything is deleted, so a bad
`--count` or a generator that throws costs nothing instead of leaving an empty
collection.

There are no accounts here and so no logins to print, but the seed ends with the
same plain-text summary block every other platform ends with: what the map will
now show, how much of it is invented, and how to clear it.

**What it writes did not happen.** It exists so the crime filter can be
demonstrated before the interviews behind that layer exist. Everything it makes
carries `source: "example"`, and the app treats that as a different kind of
object everywhere it can appear:

- a hollow dashed ring instead of a solid dot,
- `EXAMPLE DATA — NOT A REAL REPORT` as the first line of the popup,
- a banner in the panel, with a clear button, while any are loaded.

A fabricated point sits on a real street, and the only thing keeping it from
being read as a record of a real event is that the screen says otherwise
everywhere it appears. The notes are visibly placeholder text for the same
reason: invented first-person testimony is exactly the material the real
interviews will supply, and a convincing fake of it in the same collection is
how a fake ends up quoted as a finding.

The generator is deterministic — same options, same points — so a reseed does
not silently invent a different fictional city.

## Secrets

Maddie is run behind the [platform reverse proxy][proxy], and its card there has a
**🔑 Fix secrets** button that generates any of these that are missing and restarts
the app.

[proxy]: https://github.com/aschkan/platform-reverse-proxy#how-secrets-work

| Variable | Shape | Why it matters |
| --- | --- | --- |
| — | — | This app needs no secrets. |

Maddie has **no** signing key, no session, no login and nothing encrypted at rest.
`MONGO_URI` is configuration, not a secret this button generates, and it is optional
— without it reports live in each visitor's browser.

Its entry in the proxy's `platforms.json` therefore declares `"secrets": []`. That
is an answer, and it is deliberately different from having no `secrets` key at all:
the first means "needs none", the second means "nobody has said". The panel treats
them differently, and 🔑 Fix secrets on Maddie correctly does nothing.

### The proxy does not guess these names — this repo declares them

The button used to generate the same three variables for every platform on the box
(`JWT_SECRET`, `JWT_ADMIN_SECRET`, `ENCRYPTION_KEY`) because that list was hardcoded
in the proxy. That is only correct for Shoppix and Nooshin. Everywhere else it wrote
variables the app never reads, reported success, and left the real problem in place.

So the names above live in **this platform's `secrets` array in the proxy's
`platforms.json`**. If a secret is added to this app, add it there too, or the
button will not know about it. The full contract is in the
[reverse proxy's README][proxy].

This app does **not** serve the operator API (`/api/operator/*`), so it takes no
`OPERATOR_KEY`. The panel will refuse to write one and say why — a key nothing
reads is worse than no key, because it looks like the problem is solved.

### Fill in, never rotate

A secret that is already set is **left exactly as it is** and reported as kept.
That is not timidity: regenerating a signing key signs every user out, and
regenerating an encryption key makes everything already encrypted permanently
unreadable. Rotation is a separate, deliberate action.

Secrets are written to **this app's own `.env`**, in this checkout, which is the
one file the proxy spawns it with. There is no second env file: the proxy used
to keep an "orchestrator override" at `env/<name>.env` and merge it on top,
which made every shared secret a two-place edit — a value written to one and not
the other left the app and the proxy disagreeing, and an `OPERATOR_KEY` that
disagrees answers 401 on every call. If you are upgrading a box from that
layout, `node scripts/merge-env.js --write` on the proxy folds the override in
once.

## SSL

The certificate for `maddie.arsaces.ir` (and `*.maddie.arsaces.ir`) is issued through the platform
reverse proxy's **🔒 SSL** button — Let's Encrypt, with the DNS TXT records added
by hand. The button shows the days left and renews with the same flow.

The short version of [the full contract][ssl]:

[ssl]: https://github.com/aschkan/platform-reverse-proxy#ssl--getting-and-renewing-certificates

- **A wildcard is required** (tenants/subdomains), and Let's Encrypt only issues
  wildcards over the **DNS-01** challenge — so a person publishes a TXT record and
  the flow waits for them. Expect **two** records under the same
  `_acme-challenge.maddie.arsaces.ir` name: the apex and the wildcard are two authorisations.
- **The server cannot reach Let's Encrypt directly.** It cannot resolve
  `acme-v02.api.letsencrypt.org`, so certbot is given an HTTP proxy — a field on the
  button's form. By hand this is `sudo env http_proxy=… https_proxy=… certbot …`,
  and the `env` matters because `sudo` strips those variables.
- **Where certificates land is configured on the proxy, not fixed.** By default
  `/etc/letsencrypt/live/maddie.arsaces.ir/{fullchain,privkey}.pem` — where this
  platform's `certPath`/`keyPath` already point. But the proxy does not run as
  root (it reads the keys through a group), so certbot cannot write there
  unless `ACME_SUDO=true`; the alternative, `ACME_CONFIG_DIR`, puts them
  somewhere else entirely. The SSL panel prints the real path before issuing
  and offers to update this platform's `certPath`/`keyPath` when the two
  differ. The proxy reloads them by mtime — nothing here restarts.
- **Manual-DNS certificates do not auto-renew.** They last 90 days; renew inside the
  last 30. The contact email on the form is where the only expiry warning goes.

Nothing in this repo serves TLS itself — this app listens on plain HTTP on loopback
and the proxy terminates TLS in front of it.

### Which server it runs on

The panel serves **both** machines. A selector next to its title chooses which
one every button acts on — 🔒 SSL and its renew, 🔑 Fix secrets, 💣 Reseed DB,
the process controls, the env editor. Leave it on *this server* and nothing
changes; pick the peer and the same buttons run over there instead.

That matters most for certificates, because **a certificate is per machine**.
Let's Encrypt is not aware there are two servers: issuing on one leaves the
other still serving the old certificate, or none. When both servers answer for
this domain, issue or renew on each of them — switch the selector and press the
button again.

While a peer is selected the header names it and a banner says so under the
tabs. The selection is deliberately forgotten on reload, so a panel opened fresh
always acts on the machine serving it.

## What it is built on

| Piece | Service | Key needed |
|---|---|---|
| Map and tiles | [Leaflet](https://leafletjs.com) + [react-leaflet](https://react-leaflet.js.org) over [OpenStreetMap](https://www.openstreetmap.org) | no |
| Routing | [OSRM](https://project-osrm.org) — the engine behind OSM's own directions | no |
| Address search | [Nominatim](https://nominatim.org) | no |
| Street data | [Overpass](https://overpass-api.de) over OpenStreetMap | no |
| The sentence | a local OpenAI-compatible model, Liara as fallback | local: no |

The first four are fetched **by the browser**. There is exactly one API route,
and it exists for one reason: the model cannot be called from the browser — the
LAN box is unreachable from a phone, and the hosted key would be shipped to
every visitor.

## The model

Local first, hosted fallback:

```bash
LOCAL_AI_HOST=192.168.11.165     # LM Studio on :1234, no key needed
LOCAL_AI_MODEL=gemma-3-4b-it

LIARA_AI_URL=                    # both, or the tier is skipped entirely
LIARA_AI_KEY=
```

Local first because it is free per call, private — this app is told where
someone is walking and at what hour — and cannot be rate-limited or cut off for
a billing failure. Liara only when the LAN box is off.

Both values are needed for the fallback: a URL with no key 401s on every call,
turning "the LAN box is off" into a confusing error instead of a quiet
degradation.

**If neither answers, the page still works.** You get the score and the
findings; only the sentence is missing.

## Configuration

Everything has a working default. These exist for when a default is not enough:

| Variable | Default | Why you would set it |
|---|---|---|
| `NEXT_PUBLIC_TILE_URL` | OpenStreetMap | A different tile server, or one you host |
| `NEXT_PUBLIC_OSRM_URL` | `https://router.project-osrm.org` | Your own OSRM |
| `NEXT_PUBLIC_OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Your own Overpass, or a mirror |
| `NEXT_PUBLIC_NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Your own Nominatim, or this server's forwarder |
| `MONGO_URI` | *unset* | Share reports across visitors instead of keeping them per-browser |
| `OSM_PROXY_ENTRY` / `OSM_PROXY_LIST` | *unset* | Go out through two chained proxies — see above |

## About the free services

They are free, and they are somebody's donated hardware.

**OSRM's public server is a demo.** It is rate limited, occasionally down, and
offered with no uptime promise. It also reliably serves only the **driving**
profile — walking and cycling have come and gone on that host, and a 400 there
is the server, not this app. For anything real, run your own:

```bash
docker run -t -i -p 5000:5000 -v "${PWD}:/data" osrm/osrm-backend \
  osrm-routed --algorithm mld /data/netherlands-latest.osrm
```

then set `NEXT_PUBLIC_OSRM_URL=http://localhost:5000`.

**Nominatim asks for no more than one request per second.** The address box
debounces and keeps one request in flight; do not remove that.

**OpenStreetMap's tile policy** asks heavy users to run their own tiles. A small
app is fine; a popular one should set `NEXT_PUBLIC_TILE_URL`.

**Overpass hands out a couple of query slots per IP.** Routes are read one after
another rather than in parallel, and the layer query waits for the map to stop
moving — a 429 earned by panning would take out the route read as well, and the
whole page then looks broken because it asked for too much at once.

Night mode inverts the tiles in CSS rather than loading a dark basemap from a
second host. One provider is one thing that can be unreachable, and a blank
background is the worst possible failure on a page about walking after dark.

## If the map is blank

The page tells you when tiles fail to load, because a grey rectangle otherwise
looks like an empty place rather than an unreachable server. If you see that
message, the browser could not reach the tile host — that is a network
question, not a bug in the map.
