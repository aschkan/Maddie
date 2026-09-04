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
npm run check      # typecheck, lint, and 93 tests — all offline
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
entered in this browser**, stored only there, starting empty. It never touches
the route score. An empty map means nothing was written down — which is not the
same as nothing having happened, and the panel says so rather than leaving the
blank space to be read as reassurance.

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
