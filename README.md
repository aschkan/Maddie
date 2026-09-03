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

## What it is built on

| Piece | Service | Key needed |
|---|---|---|
| Map and tiles | [Leaflet](https://leafletjs.com) + [react-leaflet](https://react-leaflet.js.org) over [OpenStreetMap](https://www.openstreetmap.org) | no |
| Routing | [OSRM](https://project-osrm.org) — the engine behind OSM's own directions | no |
| Address search | [Nominatim](https://nominatim.org) | no |

All three are fetched **by the browser**. There is no server-side code beyond
rendering the page: no API routes, no proxy, no secrets.

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
