# Maddie — Evidence Dashboard

**Version 2.0 · 13 October 2026 · supersedes `Maddie-Design-System.md` for everything a person sees**

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
6. **The caveats live on the page.** "CONCEPT MOCKUP · Synthetic example data" sits in the subtitle whenever anything invented is on screen. "Observed reports describe this dataset, not incident risk." An invented narrative carries **EXAMPLE — NOT A REAL REPORT**. The area board has a provenance table.
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
