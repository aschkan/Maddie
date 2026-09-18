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

## The page is mobile first

The whole thing is written for a **360px phone** and widened from there, because
that is where it is used: outside, one-handed, often in the dark.

**The map is the page.** The trip card floats over the top of it and collapses
to a single line the moment both ends are set — before that it is two address
fields, and after that it is something you glance at. The panel is a sheet you
drag up from the bottom, with three stops: collapsed it shows the verdict, the
distance and the tabs and nothing else; half-open it shows the routes; fully
open it shows everything. The map's own buttons ride above it, bottom-right,
where a thumb already is.

**The panel's contents are three tabs**, not one long scroll — Route, Safety,
Layers. The scroll was six screens deep on a phone, and the safety read, which
is the thing the page exists for, was four of them down. The tab bar sits at
the bottom below 900px: the top of a phone screen is the hardest place to reach
with the hand that is holding it.

Nothing interactive is smaller than 44px, no input is under 16px (anything less
and iOS Safari zooms the page on focus and never zooms back), long values wrap
instead of widening the page, and the header, tab bar and map buttons all
respect `safe-area-inset-*`.

From 900px up the sheet becomes a sidebar and the tabs move to the top of it.
That is the only breakpoint, and it adds to the phone rules rather than undoing
them — there is no `max-width` query in the stylesheet at all.

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
`src/lib/score.ts`, where anyone can check them. A model asked to invent a
safety number would produce a confident one with nothing behind it.

**"Unknown" is never "fine".** Most streets in most of the world carry no `lit`
tag, and an unlit street and an unmapped one look identical in the data. When
coverage is too thin the page says so and shows no score at all, rather than a
reassuring number drawn from an empty map.

**The route is scored in stretches, not just as a whole.** One number over a
4 km walk is an average of a lit high street and the 400 m of unlit park path in
the middle, and the average is precisely the part you cannot act on. So the same
counts are re-summed over windows of about 400 m, each window is scored by the
same function the whole route is, and the line on the map is coloured by what
each stretch says. The panel names the worst one — *"the worst stretch is the
508 m along Westerpark Path — 5/100, against 40 for the route as a whole"* —
when, and only when, one is clearly worse than the rest.

Four hundred metres is not an arbitrary number: the score gives the lit fraction
full weight at about fifteen known samples, and samples are taken every 25 m, so
it is the shortest window that can carry a lighting reading at all. A grey
stretch is one OpenStreetMap says too little about. It is drawn differently from
a badly lit one on purpose — "nobody mapped this" and "this is dark" are
different statements, and one of them is not about the street.

**"Dark" is worked out from the sun, not from the clock.** It used to be
`hour >= 20 || hour < 6`, which is a fact about a clock face: 22:00 in Amsterdam
in June is broad daylight and was scored as night, and 18:30 in Tehran in
December is ninety minutes past sunset and was scored as day. Lighting carries
four times the weight after dark as it does by day, so in both cases the verdict
turned on the wrong fact. `src/lib/daylight.ts` computes the sun's elevation
from the NOAA solar equations — arithmetic, no dependency, accurate to about a
minute of sunrise — and there are three states rather than two: day, civil
twilight, and night. Dusk is neither of its neighbours, and folding it into
either is what produced both errors.

The hour you set is read in **your** browser's timezone, and the elevation is
then exact for the route's own coordinates. Planning a walk in another timezone
is off by the difference between the two; carrying a timezone database to close
that gap would cost more than the gap is worth. Where the place is not known at
all, the old clock rule stands in and the panel says `(by the clock)` rather
than passing a guess off as a sunset.

## Walking it — Google Maps does the navigating

Under the route summary there is one button: **Navigate in Google Maps**. It
opens Google's turn-by-turn — with *this* route, not Google's.

That distinction is the whole feature. A link to the destination would hand the
problem straight back to the router this app exists to disagree with: Google
plans the fastest way, and the point of Maddie is that the fastest way is not
always the one worth walking. So the route travels with the link, as waypoints.

* **Up to nine of them** — the documented ceiling of Google's URL scheme, above
  which the link is rejected outright rather than degrading.
* **Spent on the corners, not spread evenly.** Even spacing burns waypoints on
  long straights where Google would go the same way unprompted, and leaves
  nothing for the one turn where the two routes part company. The route is
  simplified with Douglas–Peucker, which keeps exactly those corners.
* **The panel says what was lost.** Nine points approximate a route, they do not
  reproduce it, so it reports how many waypoints went and roughly how far the
  simplified shape strays from the real one.

**Why not navigate in the page?** There was an in-app navigation view — tilted,
heading-up, MapLibre — and it was removed. Spoken directions, rerouting, a lock
screen and somebody else's battery budget are not worth rebuilding, and a person
walking home at night is better served by the app they already know. What this
app is for is deciding *which way round to go*, and that part travels.

**What does not travel is the safety read.** The lit stretches, the stretch worth
taking care on, the verdict — those stay here, which is why the button says so
and why it sits under the read rather than above it. Look first, then walk.

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

Switched on in the filter panel, drawn over whatever is on screen. The three
OpenStreetMap ones are a single Overpass query, debounced until the map stops
moving; the police-figures layer is its own pair of requests. All of them are
asked only at zoom 14 or closer — the area below that is too big to ask about.

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

**Police figures — blue-grey badges.** The official figures, and a separate
layer on purpose. Offences recorded by the police, from CBS StatLine table
`47022NED` ("Geregistreerde misdrijven; soort misdrijf, wijk, buurt,
maandcijfers"), whose offence classification is the police's own. A badge sits
at the middle of each neighbourhood on screen carrying its average recorded
offences per month; the popup breaks that down by category and says what window
it covers.

Three things about it are the whole design, and all three are on the screen:

* **It is per neighbourhood per month.** That is the finest grain this data has
  anywhere in the country — there is no point-level feed, and inventing points
  inside a neighbourhood so the shapes match would be fabricating evidence. The
  badge sits at a centroid because the figure is for the whole area; nothing
  happened at that dot.
* **It does not touch the route score.** A walk usually stays inside one
  neighbourhood, so these numbers would hand every candidate route the same
  answer — they cannot say which way round is better, which is the only
  question this app asks. `score.ts` stays on OpenStreetMap, which changes
  street by street. Adding this layer did not change that argument — it is the
  reason the layer sits beside the score rather than inside it. `CLAUDE.md`
  § "Why OpenStreetMap and not crime figures" is the long version.
* **It misses most of what this app is about.** Harassment and catcalling are
  not offences anyone is charged with, so they appear in no police table
  anywhere. That gap is exactly what the purple layer is for. Neither layer
  replaces the other and they are never merged.

And the caveat the panel repeats: more recorded offences is not more dangerous.
Reporting rates, footfall and how heavily an area is policed all move these
numbers, and a busy centre records more of everything than a quiet street
nobody walks down.

The join is PDOK's Locatieserver — the Dutch government's own geocoder, free
and keyless — which is the one service that returns the CBS neighbourhood codes
the figures are published against. Nine probes are spread across the visible box
and deduplicated by code, so a view sitting inside one neighbourhood draws one
badge. Netherlands only: outside it there is no Dutch neighbourhood to resolve,
and the panel says that rather than drawing an empty map, because a blank layer
here would read as "no recorded crime".

Four traps in this table have each cost a wrong number on screen, and each has a
test in `test/nl-crime.test.ts`:

| trap | what it produces |
|---|---|
| the roll-up row is `Misdrijven, totaal` — **with a comma** | it is summed alongside the rows it totals, and every figure roughly doubles |
| `null` means **withheld**, not zero | a neighbourhood reads as having had nothing happen in it |
| periods must be **enumerated**, never a `ge`/`le` range | the annual `2025JJ00` codes sort inside the range and the year's own total is added to its months |
| divide by the months that **answered**, not those asked for | the rate is understated by exactly the reporting lag |

The most recent month is skipped for the same reason as the last of those: police
figures lag, and a half-filled month reads as a sudden drop in crime.

## Where the browser asks for the map

Tiles, routing, address search and the OpenStreetMap query all go to
**`/api/osm/*` on this server**, and the server fetches them — straight out
where it can, and through the proxy chain below where it cannot. That is the
default, with nothing configured.

It used to go straight from the browser, which is the tidier shape: no server
in the path, nothing to scale, nothing to pay for. It stops working the moment
a network in the way cannot reach those hosts — and this app answers from more
than one machine. One can reach the internet, one cannot, the same build is
deployed to both, and a visitor may be on a network that reaches neither.
Asking this server is the only arrangement that works in every combination,
because the server is the one host that is certainly reachable: the page came
from it. Both machines then behave the same from the browser's side.

**This app's own API is never involved.** `/api/assess` (the model) and
`/api/reports` (the crime layer) are same-origin calls to the box that served
the page. There is nothing to reach around, and the forwarder's table of
upstreams holds neither of them, so they cannot be routed through it even by
mistake.

A **502 from `/api/osm/*` is this server** saying nothing it tried got out —
not OpenStreetMap being down. The page says so in those words, and
`/api/osm/status` says which routes were tried and what they answered.

**None of this is configurable at run time, and that is on purpose.** Where the
browser asks is decided in `src/lib/endpoints.ts`, the upstreams behind it in
`src/lib/osm-forward.ts`, and both are constants. They used to be
`NEXT_PUBLIC_*` variables, which are inlined at *build* time — so a value set on
one of the two machines and not the other, or set after the build, is a value
that silently does nothing. Pointing a service at your own OSRM or Overpass —
the right answer for a real deployment, and the one that removes the rate limit
and the reachability problem together — is a one-line edit in `endpoints.ts`
and a rebuild.

## When the browser cannot reach OpenStreetMap

Tiles, routing, search and Overpass are normally fetched **by the browser**,
which is why a proxy on the server does nothing for them. This app sends them
through the server instead, at `/api/osm/*`, and that is the shipped default —
there is nothing to switch on.

The upstream for each is fixed in a table in `src/lib/osm-forward.ts` and cannot
be named by the request — a forwarder whose target comes from a query parameter
is an open proxy.

### Getting out when this server's own internet is filtered

The forwarder tries to fetch OpenStreetMap **directly first**, and only when
that has actually been shown to work — it is probed on a schedule, so the
machine that cannot get out never pays a timeout to rediscover that, and the
machine that can does not send every tile through somebody else's box. When
direct does not work, it goes through a proxy:

```
browser → this server → a proxy from the pool → OpenStreetMap
```

`proxies.json` in the repo is the starting list and there is nothing to
configure: the server probes it, throws out what does not work, and goes and
finds more when it is short. To pin a specific proxy, put it in `proxies.json`
— there is no environment variable for it, and the dials that used to be
`OSM_PROXY_*` are constants at the top of `src/lib/proxy-pool.ts`.

That file used to hold 649 scraped proxies. A full sweep put every one of them
at dead, and probing them cost a few minutes of every boot to learn it again,
so it now holds what is known to work. `npm run proxies` re-probes whatever is
configured.

#### Asking less, before asking from somewhere else

Rate limits are the usual reason the map goes quiet, and the first answer is
not more exit IPs — it is fewer requests.

The biggest saving is the shape of the question. The visible box used to go
into the Overpass query at five decimal places — a metre — so dragging the map
one pixel asked a different question, and a service that hands out two slots
per IP got a fresh one every time. The box is now rounded outward onto a grid
about six cells across the screen, so a pan inside one cell asks the question
that was already answered. Over sixty small pans that is 60 queries before and
9 after. The page also refuses to re-ask a question it has already asked, and
when Overpass does say it is limiting us it leaves the layers alone for a
minute rather than retrying on the next twitch of the map.

On top of that, this server remembers what it already fetched: ten minutes for an Overpass query, an hour for an address
search, a week for a tile. The layer query re-runs every time the map settles
after a pan, and panning back to where you were is the commonest thing anyone
does on a map; that used to be a fresh query every time. The cache is bounded
by bytes, drops the least recently used first, and never stores a 429 or a
5xx. `x-osm-via: cache` on a reply means it never left the building.

What the proxies are then for: when a request *does* go out and comes back
429, that limit belongs to the exit IP it went out through, so it is retried
from another one. The durable fix for a deployment that needs more than the
public service offers is to host Overpass yourself — that removes the limit
and the reachability problem in one go — the `overpass` entry in
`src/lib/osm-forward.ts` points at it.

#### The server keeps its own list, and tops it up by itself

The two machines this answers from have different egress, so they need
different proxies. `proxies.json` in the repo is a **seed**, the same on both.
What each machine actually found to work goes in `.data/proxies.json`, which
is gitignored and per checkout, and is read first on the next boot — so a
restart is not a cold start, and neither server overwrites the other's
findings.

When a machine is short of working exits it goes and looks: it downloads the
public lists — GitHub-hosted, listed in `src/lib/proxy-sources.ts` — probes a
few hundred fresh addresses against Overpass sixty at a time, keeps the ones
that answered and writes them down. That happens in the background, at most
once an hour. If the box cannot reach GitHub either, the lists are fetched
through an exit that already works.

It used to skip this entirely on a server that could reach OpenStreetMap by
itself, on the reasoning that such a machine needs no proxy. That was true
while the proxies were only about *reachability*. They are also how a rate
limit is got around now, and a rate limit lands on precisely the machine that
can reach OpenStreetMap — its own IP is the one that has used up its share. So
both boxes keep a pool.

You can still do it by hand, which is worth doing once on a new box to see
what happens:

```bash
npm run proxies -- --scrape --save
```

#### A second hop in front of the list — rarely needed

Only for a network where the proxies in the list are themselves reachable
solely *through* one other proxy:

```
browser → this server → the entry proxy → one of the pool → OpenStreetMap
```

Leave `ENTRY_PROXY` in `src/lib/proxy-pool.ts` at `null` unless that is your
situation — which is what ships. Both are plain
HTTP proxies, so this is two `CONNECT`s stacked with TLS on top;
`src/lib/proxy-chain.ts` has the detail and the tests stand up two real proxies
on loopback to prove it.

The list is probed in the background — the real chain, to a real upstream — and
ranked working-first, fastest-first, with a failing hop resting for longer each
consecutive time. Nothing trusts a list's own metadata: the scraped list this
was built for claimed `https: false` for every entry, which taken literally
would mean not one can tunnel.

```bash
npm run proxies                      # probe the current list and print what works
npm run proxies -- --all             # including the dead ones and why
npm run proxies -- --scrape          # download fresh public lists first
npm run proxies -- --scrape --save   # ...and keep only the ones that answered
```

`GET /api/osm/status` says the same thing on the running app, and every
forwarded reply carries `x-osm-via` (which exit answered) and `x-osm-attempts`.

**If everything fails with `refused with 403`, the list is fine and the entry
proxy is the problem.** A Squid-style proxy allows `CONNECT` to port 443 and
nothing else out of the box, and these hops are on 8080, 999, 3128. Both
`npm run proxies` and `/api/osm/status` call that case out by name.

### When the entry proxy is the thing that is down

Everything goes out through the entry proxy when one is set, so if that one
machine is not reachable, every proxy in the list fails with the same message. That used to
read as "the whole list is dead" — `total: 649, working: 0, resting: 536` —
when in truth not one of them had been contacted.

So the entry is checked on its own, with a single TCP connect, and
`/api/osm/status` leads with a sentence rather than a table:

> The entry proxy 198.51.100.7:2000 cannot be reached from this server (no TCP
> connection within 4000ms). Every exit is being tried directly instead — check
> that this machine is on the same network as 198.51.100.7, and that something
> is listening on port 2000.

Two things follow from that. A failure to reach the entry is never held against
an exit, so the list is not blacklisted for somebody else's fault. And the
exits are then tried **directly**, without the entry: it is there because the
exits are assumed to be reachable only through it, and when it is gone that
assumption is worth testing rather than enforcing. If they cannot be reached
directly either, those attempts fail as they would have done anyway.

### A route read is several queries, going out at once

A route read used to be one Overpass query over the whole corridor, sent on its
own because parallel queries are what earn a 429. That holds only while every
query leaves from the same IP. It stopped being true once the forwarder had a
pool of exits, so a route is now cut into **up to four pieces that go out
simultaneously, each through a different exit**:

```
                    ┌─ piece 1 ─→ exit A ─┐
route ─ chunkPath ─ ├─ piece 2 ─→ exit B ─┤ ─ merge ─→ one set of counts
                    ├─ piece 3 ─→ exit C ─┤
                    └─ piece 4 ─→ exit D ─┘
```

Overpass's limit is per IP, so four quarters through four exits are one query
each rather than four from one address — and the read finishes in the time the
slowest quarter takes rather than the sum. Nothing here asks for a particular
proxy: the pool skips a hop that is already carrying a request, so the pieces
are handed distinct exits on their own.

**How many pieces is decided by the route and by the pool, not by a constant.**
Length says how many the walk warrants — about one piece per 2.5 km, up to
twelve — and every forwarded reply carries `x-osm-exits`, the exits that are
free right now, which says how many can be in the air. The smaller wins.

The pool's number is halved before use, and that is not caution for its own
sake: a piece is not one request, because when its exit fails it rotates up to
four times. A read split as wide as the pool contends with itself, and on a list
of mostly dead public proxies the unlucky piece spends every attempt on corpses
and fails — which fails the whole read.

**And direct is one exit, however big the pool is.** The forwarder tries this
server's own address first whenever it works, so without a cap every piece of a
parallel read left from that one IP at once — the per-IP limit, reached from the
inside. Two may take it at a time; the rest go straight to a proxy.

That was not hypothetical. A live status page read `working: 4, resting: 19`,
and a fixed four-way split there wanted sixteen exit-uses from four proxies at
four to eight seconds apiece. Two pieces down four exits is the same read with
room for each to rotate.

**Shrinking the split is the fallback, though — the plan is a bigger pool.** A
long walk cut twelve ways wants dozens of exits at once, and a rate-limited one
rests for a minute, so the cooldown only works if there is a deep bench behind
it. The server keeps going until it has 24 working exits: seventeen public
lists, up to 1500 fresh addresses a round probed 150 at a time, and when it is
down to fewer than six it goes back every five minutes instead of every hour.

Three rules make the split safe to have:

* **The pieces share their boundary vertex**, so the corridors join with no gap.
  A gap would leave an unqueried notch in the middle of the route with no ways
  under it — reported as "nobody has mapped this" and drawn grey, which is a
  claim about OpenStreetMap that would be false.
* **What comes back is deduplicated and counted once**, over the whole path, by
  the same `readRoute` as before. Two corridors both return the ways around the
  vertex they share; counting a lamp twice because the route happened to be cut
  beside it would make the score depend on where the cut fell.
* **A piece that fails is asked again**, up to three rounds, and only the pieces
  that failed — the ones already read are never re-fetched. Without that, a
  16 km walk cut seven ways failed as a whole the first time any one piece got
  a 502, with the other six read and thrown away. A rate limit is the exception:
  a 429 means every exit has already been tried, so it ends the read at once
  rather than holding the limit open.
* **One missing piece still fails the whole read**, once the retries are spent.
  Answering for six sevenths of a walk and silently reporting the seventh as
  unmapped is worse than saying so. The whole read is capped at a minute.

Short routes — under 1.5 km — are not cut at all. Four queries to answer what
one answers as fast is four slots spent for nothing.

Routes are still read **one at a time** relative to each other. Three routes
in parallel would be twelve requests in the air and would need twelve working
exits to stay under the limit.

### When the rate limit is reached, the page says so

A request that comes back rate limited is retried from a different exit and a
different mirror, because that is the only way to get an answer on a network
that cannot reach the mirrors directly. Four attempts, no more.

**When all four are refused, the page says that in words rather than failing
vaguely.** The server answers `429` — not the `502` it uses for "nothing got
out", which is a different failure and names this server as the broken thing —
and includes how many exits it spent. A 429 seen only on the direct attempt
counts too: with an empty pool there is nothing to rotate to, and reporting that
as unreachability is how a rate limit came to print "This server could not reach
OpenStreetMap" above a route the same page had just scored. The page turns that into:

> We have reached OpenStreetMap's rate limit for the map data. We tried 4
> different exits and each was refused. Wait about a minute and try again.

That is a statement of fact by the time it is read: the retrying has already
happened, quietly, and has already failed. There is nothing left to try, so
saying "still loading" would be a lie and saying "could not reach
OpenStreetMap" would send whoever is debugging at a proxy list that just did
its job four times.

None of this is a way to take more from Overpass than they offer. The cache
below is the lever that actually reduces the asking; the exits only spread what
is left, and every request identifies itself with a real `User-Agent`.

**The actual fix is to self-host Overpass** — a Netherlands extract is a
`docker compose up` — which removes the rate limit and the reachability problem
in one move, and is faster than any of this. Point the `overpass` entry in
`src/lib/osm-forward.ts` at it and the chain has nothing left to do.

## The interviews — the Research tab

The app is the prototype for a study, and the study's instrument is a
semi-structured interview: *Requirements Interviews — Women's Safety-Related
Urban Mobility Decisions*. The **Research** tab holds the interviews and what
they add up to, and the store is shaped section for section like the protocol,
so real transcripts can be typed into it later without a migration.

Two halves, in this order:

1. **What the cohort said, aggregated.** The §4 printed-list tally, the §6
   split on official figures versus lived experience, §8's presentation
   preferences, and the yes/no on contributing reports.
2. **The participants**, one expandable card each, every answer labelled with
   the protocol section it came from.

Three things about it are load-bearing.

**Interviews are their own collection, never `reports`.** `interviews` and
`reports` are separate in Mongo and must stay separate. The crime layer holds
what somebody typed about a place; this holds what a participant said across a
30–45 minute sitting with a consent form signed first. Different consent,
different retention — and, most importantly, the seed writes *synthetic*
interviews, so keeping them apart is what stops an invented quote ever sitting
in the same collection as a real one.

**There is no `POST /api/interviews`, and there must not be one.** An interview
is produced in a room and transcribed afterwards. A public endpoint that
accepted one would let anybody write a "participant" into the study's own data
— a worse version of the problem `POST /api/reports` already guards against by
forcing `source: "community"`. Interviews get in through `npm run seed`
(synthetic) or an import the researcher runs by hand. Not over HTTP.

**No database means no interviews, and the panel says so.** Unlike reports,
there is no `localStorage` fallback: a browser has no business holding a
transcript and could never have produced one. An empty list would read as a
study that found nothing, so the panel prints the reason instead.

### The synthetic cohort

`npm run seed` writes 24 invented participants. **Nobody said any of it and no
participant exists.** It is there so this panel, the tallies and the place
table can be seen working before the fieldwork is done, and it is meant to be
deleted when it is — `npm run seed -- --no-demo`.

It keeps the same three rules as the example reports on the map, for the same
reason: a banner in the panel while any are loaded, `SYNTHETIC — NOBODY SAID
THIS` as the first line of every card, and a count. A quote lifted off that
screen into a document has to carry its marking with it, because that screen is
the last point at which anybody can still catch it.

Two things it deliberately does **not** do:

- **It invents no testimony about being attacked, followed or harassed.** §3
  asks *how did you make that decision?* and what it is after is the reasoning —
  the options, the cues, what changed afterwards. So every recalled situation is
  a decision ("I didn't cycle back through the park, I took the tram"), never an
  incident. Invented first-person testimony about an assault is exactly the
  material the real interviews will supply, and a fluent fake of it is how a fake
  ends up quoted in a findings chapter. `test/interviews.test.ts` greps the
  cohort for it and fails if it appears.
- **It does not make the participants agree.** Twenty-four people who all want a
  map with scores on it would let the prototype be validated against its own
  assumptions. So two would not use such a tool at all, three want no
  personalisation and no personal data, several rate a nearby police station as
  making things *worse*, the 24/7 gym is 23-to-1 useless, only four want scores
  at all, and the room splits three ways on official versus lived. The awkward
  answers are the useful ones.

The numbers are shaped to exercise every branch of the panel — unanimous, split,
mostly-no-difference, and a place several people actively dislike. **They are
not findings, they are calibrated against nothing, and no number or sentence
from them should be quoted.**

One presentational decision worth defending: the cue tallies are shown **as the
participants said them, uncoded**, and the panel says so. Grouping "no lighting
in the park" with "unlit stretches" is qualitative coding — a research step with
a method and an audit trail behind it — and doing it here with string matching
would manufacture findings. So the list is long and repetitive, which is what
raw cues look like.

### Where the interviews meet the map

§4 hands every participant the same printed list of places, which is what makes
the tally comparable at all. Six of the seven map onto a `SAFE_SPOTS` id in
`src/lib/layers.ts` — police station, taxi stand, open café, 24/7 gym, shopping
centre, pharmacy, hospital — and that join is what lets an interview answer say
something about the map: "23 of 24 called a 24/7 gym no difference" is a
statement about the `gym24` layer. `test/interviews.test.ts` pins that every id
in the protocol table still exists in `layers.ts`, because a typo there silently
stops the aggregate lining up with the checkboxes.

The row worth reading twice is **less safe**. A place several participants call
less safe is one where drawing it as a "safe spot" is actively wrong for them,
not merely unhelpful — and the panel highlights that column for exactly that
reason.

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
| The sentence | the Liara gateway, OpenAI-compatible | yes, and it is in the source |
| Turn-by-turn | [Google Maps](https://developers.google.com/maps/documentation/urls/get-started), by link — this app never navigates | no |

The first four are fetched **by the browser** — through this server, but the
browser asks. There is exactly one API route for the model, and it exists for
one reason: the key cannot be shipped to every visitor.

## The model

**One model, configured in `src/lib/ai.ts`, with nothing to set.** The gateway
is Liara's OpenAI-compatible endpoint; the base URL, the key and the model name
are constants in that file.

There used to be two tiers — a local LM Studio box on the LAN, with Liara behind
it — and there is now one. The LAN box is not part of this deployment, and a
tier that exists only when a variable is set is a configuration the two servers
can differ on.

The model is a **chat** model. Liara's own sample snippet calls
`openai/text-embedding-3-large`, which returns vectors rather than sentences and
would refuse every request this app makes; `test/safety.test.ts` pins that the
configured model is not an embedding one.

⚠ **The API key is in the repository.** That was asked for explicitly, and the
cost is real: anyone who can read this repo can spend it. If it leaks, rotate it
in Liara's dashboard and change the constant — there is nowhere else it lives.
It never reaches the browser: `src/lib/ai.ts` is imported only by
`/api/assess`.

**If the model does not answer, the page still works.** You get the score and
the findings; only the sentence is missing. The score never came from the model
in the first place — see *The split that matters*.

## Configuration

There is one environment variable left, and everything else is a constant in
the source:

| Variable | Default | Why you would set it |
|---|---|---|
| `MONGO_URI` | *unset* | Share reports across visitors instead of keeping them per-browser |

| Constant | Where | What it decides |
|---|---|---|
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | `src/lib/ai.ts` | The model that writes the sentence |
| `FORWARD` / `PUBLIC` / `EXPLICIT` | `src/lib/endpoints.ts` | Where the browser asks for the map |
| `SERVICES` | `src/lib/osm-forward.ts` | The upstreams, their mirrors and how long replies are cached |
| `ENTRY_PROXY`, `MAX_ATTEMPTS`, `MIN_WORKING`, … | `src/lib/proxy-pool.ts` | Every dial on the proxy system |
| `PROXY_SOURCES` | `src/lib/proxy-sources.ts` | Which GitHub lists are scraped for exits |
| `MAX_CHUNKS` / `CHUNK_MIN_M` | `src/lib/overpass.ts` | How a route read is split across exits |

Why constants and not variables: this app is built once and deployed to two
machines, so a per-machine setting is a thing the two boxes can disagree about
with no answer in the repository — and pm2 replays a saved environment on
restart that dotenv will not override, which has left this deployment running a
value that existed nowhere but an old commit, three times. A constant cannot go
stale in a pm2 dump.

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

then point the `osrm` entry in `src/lib/osm-forward.ts` at
`http://localhost:5000` and rebuild.

**Nominatim asks for no more than one request per second.** The address box
debounces and keeps one request in flight; do not remove that.

**OpenStreetMap's tile policy** asks heavy users to run their own tiles. A small
app is fine; a popular one should point the `tile` entry in
`src/lib/osm-forward.ts` at its own.

**CBS and PDOK are open government data**, keyless and with no published rate
limit, which is why neither needed an account to wire in. The forwarder still
caches them — an hour for the CBS figures, a day for PDOK's neighbourhood
lookups — because both answers are stable for far longer than that (the figures
are monthly, with a reporting lag measured in weeks; neighbourhood boundaries
are redrawn once a year at most), and every cached answer is a request nobody
had to make of somebody else's donated hardware.

**Overpass hands out a couple of query slots per IP.** Two things follow, and
they only look contradictory. Candidate routes are read one after another rather
than all at once, and the layer query waits for the map to stop moving — a 429
earned by panning would take out the route read as well, and the whole page then
looks broken. But a *single* route read is split into pieces that go out
simultaneously through *different exit IPs*, which is not the same as taking
more slots from one address; see *A route read is several queries*.

Night mode inverts the tiles in CSS rather than loading a dark basemap from a
second host. One provider is one thing that can be unreachable, and a blank
background is the worst possible failure on a page about walking after dark.

## If the map is blank

The page tells you when tiles fail to load, because a grey rectangle otherwise
looks like an empty place rather than an unreachable server. If you see that
message, the browser could not reach the tile host — that is a network
question, not a bug in the map.
