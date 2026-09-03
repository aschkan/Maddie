# Route

Pick a start and a destination on a map, get the route drawn between them.

![Leaflet + OpenStreetMap](https://img.shields.io/badge/map-Leaflet%20%2B%20OpenStreetMap-7c5cff)

- **Click the map** to drop **A**, then **B** — or type an address and pick a
  suggestion. Drag either pin to move it and the route follows.
- **Drive, walk or cycle**, with distance and travel time.
- **No API keys.** Nothing to sign up for, nothing to bill.

## Running it

```bash
npm install
npm run dev        # http://127.0.0.1:5007
```

```bash
npm run build && npm run start
npm run check      # typecheck, lint, and 21 tests — all offline
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

## If the map is blank

The page tells you when tiles fail to load, because a grey rectangle otherwise
looks like an empty place rather than an unreachable server. If you see that
message, the browser could not reach the tile host — that is a network
question, not a bug in the map.
