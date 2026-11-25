# Maddie — Evidence Dashboard

**Version 3.0 · 7 November 2026 · § 7 supersedes §§ 2–4 where they disagree** (purple reports, three boards, the radar, the donut and the line chart are gone — see § 7)

Maddie is a **visualization system, not a smart app**. It does not tell anybody where it is safe. It shows what is known — and what is not — about the places a person moves through, each piece of knowledge in the chart type that piece asks for, and lets the reader decide.

The pictures this is built to are in `docs/reference/`:

| Board | Route | Reference |
|---|---|---|
| 01 · Explore urban mobility evidence | `/` | `reference/board-01-explore.webp` |
| 02 · Compare route evidence | `/compare` | `reference/board-02-compare.webp` |
| 03 · One area in detail | `/area?d=<district>` | `reference/evidence-dashboards.html`, board 03 |

`reference/evidence-dashboards.html` is the full rationale, with the chart-chooser table. The code follows these documents. `src/lib/palette.ts` holds the colours, and `test/palette.test.ts` + `test/evidence.test.ts` hold the rules a code change can quietly break.

---

## 1. Principles

1. **Decompose, don't aggregate.** There is **no overall safety score** on any board. Each factor (time, mapped lit, unknown lighting, nearby places, parkland, reports) is its own figure in its own view. A single number hides the trade-off: "Route B is best on lighting and worst on parkland" is exactly what a score collapses. (Munzner ch. 3.)
2. **The chart matches the data type** (Franconeri, L2 "Vis chooser"):

   | Data | Chart | Where |
   |---|---|---|
   | categorical × count | horizontal bars | reports by type; neighbourhoods per km of road |
   | part of a whole | donut | share of reports by type |
   | continuous distribution | histogram | hour of day; distance from report to route |
   | composition per category | 100% stacked bar | lighting by neighbourhood |
   | series over time | lines | reports per month, by type |
   | several items × several factors | dot-plot small multiples; radar | route comparison |
   | position along a path × factors | multi-track timeline | where differences occur |
   | two categories × count | heatmap | hour × weekday |
   | space | map | reports, places, selected area, routes |

3. **Brush and link, don't just filter.** Selecting a neighbourhood, clicking a bar or a slice, or brushing the hours updates every other view. (Munzner ch. 12.)
4. **Show the unknown.** Lighting nobody has tagged is a visible **hatched** category — never hidden, never imputed, never folded into lit or unlit. *"Missing lighting stays unknown."*
5. **Reports are context, not inputs.** Community reports are drawn beside the routes and counted beside them. Nothing that computes anything about a route weights them.
6. **The caveats live on the page.** Every board ends with the data's source — Pointer's credit line is a condition of using its survey — and says what a marked place is not (an incident, or a measure of risk). There is no invented data; the area board has a provenance table.
7. **Mobile first.** Every rule is written for a 360px phone. The dashboard grid in the reference pictures is what `min-width: 1180px` adds.

## 2. Colour: one colour, one meaning

| Meaning | Shape | Day | Night |
|---|---|---|---|
| a community report | **dot** | `#6d3fd0` purple | `#a78bfa` |
| a nearby place | **heart** | `#ec4899` pink | `#f472b6` |
| mapped lit (`lit=yes`) | bar / line | `#f5c400` yellow | `#fbbf24` |
| mapped unlit (`lit=no`) | bar | `#3f3f46` | `#a1a1aa` |
| lighting unknown | **hatch** | `#b8bec8` | `#64748b` |
| your selection (area, interval, row) | outline / band | `#2f6fe0` blue | `#60a5fa` |
| all displayed records | bar | `#d5d8de` | `#475569` |
| park segment | bar | `#c3c8cf` | `#3f4c5f` |
| police figures for an area | dashed outline | `#475569` | `#cbd5e1` |
| A and B | black dot + label | `#111827` | `#f8fafc` |
| Route A / B / C | **solid / dashed / dotted** | navy / light blue / grey | |

- **Purple is back, for one meaning only.** The first design used purple for the destination, "still loading" *and* reports, and a participant read the reports as places to visit. On these boards purple is a report and nothing else, and it always comes with the dot shape. The test checks that no other colour is in the purple band.
- **The four report types** are four lightnesses of that same purple — one meaning, four kinds of it.
- **Routes are told apart by line style first**, so the comparison survives greyscale and colour-vision differences.
- **No alarm red** anywhere.

## 3. Words

No *safe*, *unsafe*, *safest* or *danger(ous)* in anything a participant reads. "There is no overall safety score" names the subject, not a verdict. Interval lighting is described as *lit throughout · mostly lit · partly unlit · partly unknown · mostly unknown*.

## 4. What the team asked for after the mockups

From the voice notes of 9 and 13 October 2026:

- *"It is too much of a smart application — it should be more of a visualization system, with more visualization elements."* → The verdict, the ★ Preferred badge and the score are gone from the screen.
- *"Pick the visualization for each kind of data, as in the lectures."* → § 1.2 is that table, and every chart on the boards is in it.
- *"A radar chart is a must; pie charts; bar charts."* → Radar of every route on every factor (Compare); donut of report types (Explore); bars throughout.
- *"A pie chart of the types of crimes."* → Explore, "Share of reports by type".
- *"Number of crimes over time — a simple line chart."* → Explore, "Reports over time, by type", and the area board.
- *"A plot that compares the alternative paths."* → Compare: dot plots, the radar, and the factor table.
- *"Break the 0–100 score down; explain it."* → The score is broken out into its separate factors instead of being shown as one number. The radar's axes each have their own scale, and the card says a bigger polygon is not a better route.

The team expects to refine which chart goes with which data. Each chart type is a single component in `src/components/charts.tsx`, so swapping one is a local change.

## 5. Data honesty

- **District outlines** in `src/lib/cities.ts` are hand-traced approximations of the municipal districts. They are good to a street or two.
- **Lighting shares, road km and place counts per district** are **example figures**, marked `figures: "example"`. The provenance table says so. Replacing them is a data job: compute them from Overpass per outline and set `"osm"`.
- **Example reports** (`src/lib/example-reports.ts`) are generated in the browser and never stored. They are deterministic, sit inside their district, and are labelled everywhere. The "Example records" switch in Explore removes them.
- **Routes and per-point lighting reads are real**. In Utrecht's scenario trips they come from the committed recording, which needs no network. Everywhere else they come live from OSRM and Overpass, through this server.

## 6. Open questions

- Should the radar stay, given that a polygon's area invites a "bigger is better" reading the data does not support? It is kept because the team asked for it, and its card says why not to read it that way.
- Should the lighting figures per district be computed live (slow, rate-limited) or recorded per round of interviews, like the scenario?

---

## 7. Version 3 — after the supervisor meetings of 28 October and 4 November 2026

Both supervisors and the interview participants said the same thing: *too many graphs, and some repeat in every layout.*

### 7.1 Two audiences, two doors

| Who | View | Route | What it holds |
|---|---|---|---|
| A woman going from A to B | **Plan a route** — the landing page | `/` | three routes, factor by factor; *where do the differences occur*; the stretch you brush, with every story in it |
| The same woman, not going anywhere | **Around me** | `/explore` | the map; why places were reported (one stacked bar); when reports were made (small bars); what people do about it; a tapped neighbourhood's numbers inline |
| Researchers, police, municipality | **Data dashboard** | `/dashboard` | neighbourhoods per km of road; lighting by neighbourhood; age × reason; reports per month; distance to the route; provenance |

`/compare` redirects to `/`; `/area` redirects to `/dashboard`. No tutorial: if the first screen does not say what the tool is for, that is the design to fix.

### 7.2 Removed, and where the information went

| Removed | Why | Now |
|---|---|---|
| Pie "share by reason" | its percentages fit on the bars | "141 (36%)" on each bar |
| Radar | duplicates the dot plots; unreadable past three routes | dot plots |
| Factor table / list | the numbers are already on the dots | number on each dot |
| Area detail board | repeats Explore, area-focused | inline neighbourhood facts + dashboard |
| Age × reason matrix (main view) | a stacked bar with a toggle says it | split "by age group"; matrix on dashboard |
| Monthly line chart | sparse data — a line invents a trend | `MonthBars` |
| Lighting by neighbourhood, per-km bars, distance histogram (main view) | static, or for analysts | dashboard |

### 7.3 The map

- **Reports are dark grey, shaded by how serious they read** (`palette.ts` `REPORT_RAMP` / `REPORT_OPACITY` / `REPORT_RADIUS`; `importance.ts`). Darkest, most opaque, slightly larger = what the reader counts as most serious; the lightest is little more than an outline. The default order is shown on screen and can be dragged: *story mentions harassment or catcalling → happened to me → happened to others → feels threatening → other*. A record with several reasons takes its most serious one. The harassment flag is a basic Dutch/English keyword check of the story — a hint about how to shade a dot, labelled as such, never a classifier and never counted.
- **Lighting sits under everything** in its own Leaflet pane.
- **The popup** says why, when, what the respondent does about it, and the story (with a Translate link) — plus one line crediting the source.

### 7.4 Crowd

Participants all named crowdedness beside lighting, and that *not every crowd is a good crowd*. OpenStreetMap records no footfall, so two stand-ins are shown separately and never merged: **busy streets & squares** (`highway=pedestrian`, teal `+`) and **bars, pubs & cafés** (brown square). Both are counted per route (within 60 m) on Plan a route, drawn as a timeline track, and switchable on both maps.

### 7.5 Colours added

| Meaning | Day | Night |
|---|---|---|
| report, five ranks | `#252131` → `#c9c7d2` | `#f4f2f8` → `#5e596b` |
| park segment | `#41ab5d` green | `#74c476` |
| busy streets | `#11898a` teal | `#2cc8c8` |
| bars, pubs, cafés | `#7f4a12` brown | `#a0601c` |
| age bands (chart only) | ColorBrewer BuPu, 9 classes | |

### 7.6 Still open

- Data permissions for the Pointer set (public display of single places, stories, aggregates, retention) — to be confirmed with the university's data contact.
- The CBS police-figures feed does not reach the map yet.
- A real crowd/footfall source, and whether a crowd's *kind* can be read from the stories.

## 8. Version 4 — after the supervisor meeting of 25 November 2026

Plan a route is the main view ("the creative, innovative part"); everything below is about it. Around me and the dashboard get only the basics: the default chart for the type of data, and the same words as Plan a route.

### 8.1 Routes: one encoding, no recommendation

- **Colour only.** Solid / dashed / dotted on top of three inks was a double encoding, and the dashes read as "less certain" or "less recommended". The app recommends no route — "that's their decision" — so every line is solid and the same width, and no route is brighter or heavier than another.
- **No route is blue.** Blue means *what you picked* (area, brushed interval) and nothing else. A selected route is shown by **opacity** (100% vs 80%) and an outline on its chip, never by changing a colour.
- **Overlap is drawn side by side**: routes sharing a street are offset a few pixels, so three options read as three, from start to destination.
- **"Route A/B/C" is ONE chip** (`RouteChip.tsx`) — the route's colour, white text — identical on the map, beside the bars, on the timeline, in the side panel, in the legend.
- **Start / Destination, not A / B.** The trip's ends were "A" and "B", which collided with Route A and Route B ("AA. Utrecht Centraal"). The tap-to-set control uses an outline, not the selection blue.

| Meaning | Day | Night |
|---|---|---|
| Route A | `#7a4fa3` purple | `#b08fd6` |
| Route B | `#d95f02` orange | `#fd8d3c` |
| Route C | `#ae017e` magenta | `#dd3497` |

`test/palette.test.ts` checks the three are ≥ 40° apart in hue, ≥ 45° from the selection blue, and within 0.2 of each other in lightness.

### 8.2 Same names, same order, above and below

The numbers (top right) and the timeline ("Compare the routes along the way") use the same groups in the same order: Duration · Lighting · Places to go in · Reported places · Crowd (busy streets, bars) · Parks & underpasses. Group headers sit over their sub-columns. "Where do differences occur?" was renamed — people may look for similarities too.

### 8.3 The numbers are bars

The dot plot (with its meaningless 0–50–100 axis on a duration) became **bars**: absolute bars for minutes, counts and metres, each from zero with the number printed; and one **100% bar** for lighting (lit · unlit · unknown, hatched). On Around me, "What people do about it" is now a 100% bar per answer (the whole bar = everyone who answered) instead of two same-length bars.

### 8.4 One legend between the map and the comparison

Every mark is explained once: routes, the cursor, lighting (lit / unlit / unknown lighting — and that the map draws **lit streets only, inside a dashed outline** where lighting was loaded), the heart (places to go in), the report dots, crowd, parks & underpasses.

"All streets look lit" was checked: not a bug. On the recorded Utrecht routes 70–85% of samples are `lit=yes`; the rest is almost all *unknown*, which the map does not draw. The outline and the legend now say what is and is not shown.

### 8.5 Reported places: classes that do not overlap

The shades were five rows that mixed two questions (what the story says, who it happened to), so one report fitted several rows. Now each report is in exactly one class (`classOf` in `importance.ts`), still reorderable:

1. harassment or catcalling mentioned, happened to the respondent
2. harassment or catcalling mentioned, happened to others
3. other story, happened to the respondent
4. other story, happened to others
5. nothing happened — the place feels threatening, or no reason given

"Data source" (OpenStreetMap + reports / OpenStreetMap only) was not a choice of sources; it is now one switch, **Show places people reported**. When it is off, the numbers, timeline and side panel say **hidden**, with strikethrough, never 0 — "they may think: nobody reported anything, it's fine."

### 8.6 Coordinated views

Tap a point on a route on the map → that route is selected, a ring marks the point, the timeline draws a line at the same progress, and the side panel describes the stretch around it. Move along the selected route on the timeline → the ring on the map follows.

### 8.7 Stories in English, in the app

`/api/translate` translates a story (the app's model first, then Google Translate's public endpoint, fetched by the server); the English is shown with "Show original". If neither answers, the original is shown with the external link.

### 8.8 Small fixes

- **Night mode:** report dots were light-grey smudges at a fifth of their opacity on a mid-grey map. At night they keep a minimum opacity (`REPORT_OPACITY_NIGHT`) and a dark outline, and the night basemap is a little darker.
- **Bars vs Route B:** the bar/pub squares were a brown of the same lightness as the orange Route B. They are now a much darker brown (`#7f4a12` / `#a0601c`); the test checks the gap.

### 8.9 Still open from this meeting

- Talk to the university's data-management contact about publishing the Pointer data before submission.
- The model gateway (Liara) answered "Workspace is not ACTIVE" on 25 Nov 2026; until it is reactivated, translation runs on the Google fallback (aschkan only) and `/api/assess` has no sentence.
