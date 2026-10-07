# Maddie — Visual Design System

**Version 1.0 · 7 October 2026 · prepared for the first round of interviews**

This document is the specification for how Maddie looks and what every part of it means. It turns the two supervision meetings into a set of rules a participant can read without being told, and a developer can check against. Every colour, shape, label and position below has exactly one meaning. Where a choice was made that the supervisors may want to revisit, it is listed at the end under *Open questions*.

The code follows this document, not the other way round. `src/lib/palette.ts` holds the colours; `test/palette.test.ts` fails if a colour is reused, if purple or red returns, or if the word *safe* or *danger* reaches a participant's screen.

---

## 1. Principles

These eight rules decide every case the tables below do not cover.

1. **One colour, one meaning.** A colour is never reused for a second thing, anywhere. The first prototype used purple for the destination, for "still loading" *and* for crime reports. During the meeting the reports were read as *"cool places to visit"*, which is the opposite of what they were.
2. **Colour is for evidence.** Hue is spent only on things that say something about the streets: how a route reads, where it is lit, where there are places to go, where people reported something. Things that are merely *yours* (the start, the destination, the routes you did not pick) are black, white and grey. *"Why the starting point needs a colour? … It can be just gray."*
3. **Name the evidence, never the conclusion.** Nothing on screen says *safe*, *unsafe* or *danger*. *"Telling somebody that this is safe is like a lot of responsibility."* Labels say what the data is ("lit", "crime reports", "open frontage"), and a reading is *Favourable* or *Look closer*, never *Safe* or *Dangerous*. The suggested route is *Preferred*.
4. **Grey and dashed means "not known".** A stretch OpenStreetMap says nothing about and a route still being read are the same statement ("we do not know yet") and look the same. *"The loading time you can also be gray, because it's uncertainty."*
5. **Every factor gets its own visual channel**, so several can be seen at once without competing. Line colour, glow, texture, shape and opacity each carry one thing. *"The lighting can be opacity … it can be a texture … as an outline of the line."*
6. **Show every possible state, and explain on demand.** The legend lists every value a thing can take, not only the ones on screen, and each group has an ⓘ button saying how it was worked out. *"Show me a legend … all the possible colors you might see … and information buttons."*
7. **The basemap is a canvas.** A grey map by day and a near-black one at night, with no colours of its own, so that every colour on it is one of ours. *"What Basak used was a very gray map … make it black … then you can easily switch the light off or on."*
8. **Organise by task, like a wardrobe.** Four tabs, one job each, in the order a person thinks: options → why → make it mine → my experience and others'. *"Organize stuff like as you would do with a drawer."*

---

## 2. Colours

Each colour has two values, one for the day map (light grey) and one for the night map (near-black), because a colour that reads on one vanishes on the other. The panel uses the day values in the light theme and the night values in the dark theme.

### 2.1 Evidence colours (the only hues on the map)

| Token | Day | Night | Means | Appears as | Never used for |
|---|---|---|---|---|---|
| `route.good` | `#0F8A7A` | `#2DD4BF` | **Favourable**: the indicators along this stretch count in its favour | the route line, chips, strip | anything that is not a route reading |
| `route.fair` | `#E07A1F` | `#FB923C` | **Mixed**: some indicators for, some against | the route line, chips, strip | lighting (which is yellow and a glow) |
| `route.poor` | `#9C3D17` | `#E4572E` | **Look closer**: several indicators count against this stretch at this hour | the route line, chips, strip | an alarm; it is rust, not red |
| `light` | `#E8B100` | `#FFE27A` | **Light**: lit streets, lamps, the lit parts of your route | a soft glow around the route; thin lines; dots | anything not about lighting |
| `place` | `#FF4F99` | `#FF6FAE` | **A place to go**: a door, a light, usually a person | a pink heart | reports; anything negative |
| `report` | `#2563D8` | `#76A9FF` | **A report somebody entered** | a speech bubble | official figures; route readings |

The route scale runs teal → orange → rust. It is a diverging scale with **no red and no purple**. Teal and orange are the pair that most forms of colour-vision deficiency still tell apart. Orange and rust also differ in lightness, so they stay distinct in greyscale and in print.

### 2.2 Neutral colours (black, white, grey; no hue)

| Token | Day | Night | Means | Appears as |
|---|---|---|---|---|
| `start` | `#6B7280` | `#9CA3AF` | **A**, where you start | a hollow ring with "A" |
| `end` | `#111827` | `#F8FAFC` | **B**, where you are going | a solid pin with "B" |
| `alternative` | `end` at 38 % opacity | same | **Another way round**, not selected | a faded line, tap to select |
| `route.unknown` | `#8A94A6` | `#8A94A6` | **Not known**: no map data, or still loading | a **dashed** grey line |
| `police` | `#475569` | `#CBD5E1` | **Police figures** for a whole neighbourhood | a **hatch** over the area; a dark label with a number |
| UI accent | `#111827` | `#F1F5F9` | **Interface**: the selected tab, buttons, the ★ Preferred pill | chrome only, never on a map feature |

### 2.3 Retired

| Was | Meant | Why it is gone |
|---|---|---|
| Purple `#7C5CFF` / `#A855F7` / `#9333EA` | destination, loading, crime reports, UI accent, all at once | four meanings for one colour; read as "places to visit" |
| Green `#16A34A` for A | the start | green was also "safe"; the start is not evidence |
| Yellow *lines* for well-lit areas on the route | lighting | read as a separate category of road rather than as a property of it; now a glow |
| Blue-grey `#4A6FA5` for police | police figures | a hue invites reading the areas as a category of place; now a texture |

---

## 3. Channels: how several factors are seen at once

The supervisor's question was how a person can combine lighting, reports and places without switching tabs. The answer is that each one uses a **different visual channel**, so they stack rather than overwrite each other.

| Channel | Carries | Why this channel |
|---|---|---|
| **Line colour** (route) | how the evidence reads, stretch by stretch | the main answer, so it gets the strongest channel |
| **Glow** around the line | how much of that stretch is lit (0–100 %) | light *spreads*, so a glow reads as light without any key. It sits *under* the line, so a stretch can be teal **and** lit at once |
| **Dash** | not known | a gap in the line is literally a gap in what we know |
| **Line weight / label** | which route is selected, and which is preferred | the recommendation must be on the map, not only in the panel |
| **Opacity** of reports | how old the report is | recent = solid, within a year = 62 %, older = 32 %. *"Perhaps you don't care about something that happened 10 years ago"*, so the map shows age instead of hiding old reports |
| **Shape** | what kind of thing a marker is | heart = place, speech bubble = report, oblong with a number = police label, ring = A, pin = B. Nothing depends on colour alone |
| **Texture** (hatch) | police figures, by density | an area statistic, not a point. Denser hatch = more recorded offences |
| **Map tone** | whether the hour you chose is after dark | the whole canvas goes dark and lit streets glow, so the map *shows* night |

### 3.1 The route, from bottom to top

```
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   ← 1. GLOW (yellow, soft) — as strong as the share of the stretch mapped lit
   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   ← 2. CASING (the basemap's own colour) — lifts the line off the streets
   ═════════════════════════════   ← 3. HALO (wide, 30 %) — only on the one stretch worth a closer look
   ━━━━━━━━━━━━━┅┅┅┅┅━━━━━━━━━━━━   ← 4. LINE, coloured per ~400 m stretch; grey + dashed where nothing is known
              ( ★ Preferred · 21 min )  ← 5. LABEL, on the line itself
```

Reading one stretch: *teal line with a strong glow* means the indicators are favourable and it is mostly lit. *Orange line with no glow* means mixed indicators, and the street is either unlit or its lighting is not mapped (the Safety tab says which). *Grey dashed line* means OpenStreetMap records too little here to say anything.

### 3.2 What is beside the route, and never inside it

Reports and police figures are **never** part of the route reading. Reports are what people chose to enter, so a gap in them reads as reassurance, and one keen reporter would move every route through their street. Police figures cover a whole neighbourhood and give every route through it the same number. Both are shown **beside** the reading so a person can weigh them, as the supervisor put it: *"throughout your path you have these three dots and the alternative has five."*

- Each route card shows **"3 reports · 5 places to go along the way"**, counting within 75 m and 100 m of the line.
- The Safety tab's table has a section headed **"Beside the reading — not part of it"** with the same counts per route.
- The Reports tab lists the reports **along the selected route** as short stories, newest first.

---

## 4. Markers

### 4.1 Places to go: the pink heart (refined)

- **A dot when zoomed out, a heart when zoomed in.** Below zoom 15 a place is a 3 px pink dot: a city centre has hundreds of cafés and stations, and at the zoom that fits a 3 km walk on a phone, hundreds of hearts become one pink mass on top of the route. The colour and meaning stay the same; the shape arrives when there is room to read it.
- **One heart for every kind of place.** Station, hospital, police station, late shop, bar, pharmacy and the rest all share the same pink heart, 24 × 22 px, with a 1.6 px outline in the basemap's colour so it stands off both tones.
- **The kind is hidden until asked for**, as the supervisor proposed: *"In the beginning my default view is just this pink safe space thing … if you really want to see … you can hover over a safe space and suddenly you see the exact icons."* The glyph (🚉 🏥 🛡️ 🛒 ☕ …) appears in a small tag above the heart **on hover**, **from zoom 17 in**, and in the **popup**.
- **Popup, first line:** "Place to go · Train or metro", then the name, then opening hours *as mapped* (only `24/7` is interpreted, because half-reading opening hours produces a confident "open now" for a shop that has closed).
- **Personal:** the Layers tab lets a person tick which kinds *they* would walk towards. A person who would not walk towards a police station can untick it.

### 4.2 Reports: the speech bubble

- Blue speech bubble, 22 × 22 px, with three white dots. It is a voice, not an alarm.
- **Age as opacity:** solid (last 3 months), 62 % (last year), 32 % (older).
- **Popup, first line:** "Report · Harassment", then date and time, district, the note if there is one, and *"Entered by a person. Shown beside the route comparison, never inside it."*
- **Filters** (Reports tab): category, and **"Only reports around 22:00"** (±3 h, wrapping midnight), for the temporal question the supervisor raised.

### 4.3 Police figures: hatch plus label

- The **whole neighbourhood** is hatched at 45°. Spacing is 11 / 8 / 5.5 / 3.8 px for *fewer / around the middle / more / most recorded offences*.
- An **oblong label** at the centroid carries the monthly average as a number: dark slate by day, light slate at night.
- **Popup, first line:** "Police figures · whole neighbourhood". It says the figure is a count for the area, not a place where anything happened.
- **Off by default.** It is the slowest layer and the easiest to misread.

### 4.4 A and B

| | Shape | Day | Night | Why |
|---|---|---|---|---|
| **A** | hollow ring, 28 px, "A" inside | white fill, `#6B7280` ring | `#0B0D12` fill, `#9CA3AF` ring | you know where you are; it is the quietest mark on the map |
| **B** | solid teardrop pin, 32 × 44 px, "B" inside | `#111827` | `#F8FAFC` | the one end that has to be *found*; the heaviest mark |

They differ in shape, fill and weight, and neither competes with the evidence colours.

---

## 5. Night: the map, not just the panel

The first prototype's night mode darkened the side panel and left the map alone. Now **the map is dark whenever either of these is true**:

1. the person switched on the night view (☾ in the trip card), **or**
2. **the hour they are planning for is after sunset**, from the sun's real position for that place and date, not from the clock.

Slide the hour from 14:00 to 22:00 and the grey canvas turns near-black, the lit streets and the glow around the lit parts of the route light up, and unlit stretches stay dark. That is the lighting visualisation. The legend's first line says why the map looks the way it does, for example *"22:00 is after dark, so the map is shown dark — lit streets glow, unlit ones do not."*

Basemap filters (one tile host, filtered in CSS):

| Tone | Filter | Background |
|---|---|---|
| day | `grayscale(1) contrast(.82) brightness(1.07)` | `#E9EBEE` |
| night | `grayscale(1) invert(1) brightness(.55) contrast(1.15)` | `#0B0D12` |

---

## 6. The legend

### 6.1 Where it is

- **Phone:** a pill button **bottom-left** of the map, labelled **"Legend"** with four coloured dots. It mirrors the zoom buttons bottom-right, both within thumb reach. It rides above the sheet as the sheet moves, and hides when the sheet is fully open or while a report is being placed. Tapping it opens a card up to 22 rem wide that scrolls inside itself.
- **From 900 px:** **open by default** in the map's bottom-left corner.

### 6.2 What it contains: every group, every state

| Group | Switch | Every state shown | ⓘ explains |
|---|---|---|---|
| **Your trip** | — | A (ring) · B (pin) · ★ Preferred pill · another way round (faded line) | why A and B have no colour; tap a faded line to compare |
| **How the route reads** | — | Favourable · Mixed · Look closer · Not enough map data, or still reading (dashed). Each has a one-line explanation | what is counted, the thresholds (70+, 45–69, under 45), that it is a reading of the map and not a promise, that reports and police figures are not in it. Link: *Why this route? →* |
| **Light** | on/off | strong glow (mostly lit) · faint glow (partly lit) · no glow (unlit, or not mapped) · a lit street · street lamps | `lit=yes`, why an unmarked street is not necessarily dark, how the glow's strength is set |
| **Places to go** | on/off | a place to go (heart), kinds on hover or close zoom · the same, zoomed out (dot) | what counts as a place, that it is not a guarantee of help. Link: *Choose which places count →* |
| **Reports** | on/off | last 3 months · within the last year · older than a year | entered by people, never scored, an empty map ≠ nothing happened. Link: *Filter or add a report →* |
| **Police figures** | on/off (off) | fewer · around the middle · more · most recorded offences (four hatch densities) | CBS, per neighbourhood per month, never in the reading; more recorded offences does not make a street worse to walk |

A group that is switched off stays in the legend, greyed. Its key is still readable, so a person can see what they would get by switching it on.

The ⓘ opens **in place** under the group heading. It is not a modal, so the map stays visible.

---

## 7. Layout

### 7.1 Phone (360 px and up)

```
┌──────────────────────────────────────┐
│ ┌──────────────────────────────────┐ │ ← TRIP CARD, floating, top
│ │ Maddie   [Study scenario ⓘ]   ☾ │ │   collapses to one line once A and B are set
│ │ (A) Utrecht Centraal             │ │
│ │ (B) Overvecht           Change   │ │
│ └──────────────────────────────────┘ │
│                                      │
│        ( ★ Preferred · 41 min )      │ ← label ON the preferred line
│   ░━━━━━━━━━━━┅┅┅━━━━━━━━━░          │ ← route: colour + glow + dash
│        ( Route 2 · 38 min )          │ ← faded alternative, labelled
│   ♥        💬              ♥          │
│                                      │
│ [● ● ● ● Legend]               [ + ] │ ← legend bottom-left · zoom bottom-right
│                                [ − ] │
│                                [ ⤢ ] │
├──────────────────────────────────────┤
│ ━━━━  (grab handle, 44 px target)     │ ← SHEET: peek / half / full
│ ★ Favourable 74/100   Route 1 · 41 m │ ← always visible: the answer in one line
│ …tab content…                        │
├──────────────────────────────────────┤
│  🧭 Route  💡 Safety  ◧ Layers  💬 Reports │ ← TABS at the BOTTOM (thumb reach)
└──────────────────────────────────────┘
```

- Tap targets are **44 px minimum** and inputs are **16 px minimum** (anything smaller makes iOS zoom the page).
- `safe-area-inset-*` padding applies on the trip card, the tab bar, the legend and the map buttons.
- Nothing scrolls sideways. The one table that could be wide (the comparison) scrolls inside its own box.

### 7.2 From 900 px

The sheet becomes a **400 px sidebar on the left** (440 px from 1280 px), with the tabs **at its top**. The map fills the rest. The trip card floats over the map's top-left, the legend sits open in its bottom-left, and the zoom buttons are bottom-right. Scenario destinations sit side by side.

---

## 8. The four tabs

| Tab | Its one job | What is in it | What it never does |
|---|---|---|---|
| **🧭 Route** | your options, and the one we suggest | travel mode (walk / cycle / drive) · hour slider with *daylight / dusk / after dark* beside it · **the route cards, with the preferred one first, in its own bordered card with a ★ Preferred ribbon and the reason in one sentence** · +min against the fastest · reading chip · reports and places along each · *Why this suggestion? →* · *Navigate in Google Maps* (not in the scenario) | explain the score in detail |
| **💡 Safety** | **why** we suggest it | the recommendation sentence · the selected route's reading with a one-line meaning · the route stretch by stretch (strip) · the stretch worth a closer look · the model's short paragraph · **a table: every factor × every route**, factors switched off struck through · *Beside the reading — not part of it*: reports and places per route · ⓘ *How the reading is worked out* | let you change anything (that is Layers) |
| **◧ Layers** | make it **yours** | **What counts in the reading**: five switches (lit streets, street lamps, open frontage, parkland, tunnels), and turning one off re-reads every route at once, may move the ★, and fetches nothing · Light on/off · Places to go on/off, with which kinds count for you | hold reports (that is Reports) |
| **💬 Reports** | **your experience and other people's** | *Along Route 1*: the reports near your route as short stories · Reports from people: on/off, *only around 22:00*, categories, **＋ Add a report** (category plus a few words) · Police figures: on/off, the hatch key, ⓘ what they are and are not | feed the reading |

The supervisor's distinction between the last two: *"It's a very different thing to tell you 'I don't like the idea that the police station is considered a safe space' and to tell you 'based on my experience, this is what is going on there'."* The first is Layers; the second is Reports.

The interviews panel that used to be a fifth **Research** tab is now at **`/research`**. It is the study team's view, not part of what a participant is shown.

---

## 9. On the screen vs. on demand

| Always visible | On tap / hover / zoom |
|---|---|
| the route coloured by reading, with glow and dashes | the kind of a place (hover, zoom ≥ 17, popup) |
| ★ Preferred on the line and on the first card | the reason for the reading (Safety tab) |
| the reading in one line in the sheet's peek row | how the reading is computed (ⓘ) |
| pink hearts, blue bubbles (faded by age) | a report's text, date and district (popup) |
| the legend button (phone) or the legend (desktop) | each legend group's explanation (ⓘ) |
| the hour and what it means (*after dark*) | the police figures (switched on in Reports or the legend) |
| a *Study scenario* chip while the scenario is on | what the scenario is and where its data came from (chip ⓘ) |

---

## 10. Words

| Say | Never say | Why |
|---|---|---|
| Preferred, suggested | Safe, safest, safer | a promise the data cannot keep |
| Favourable · Mixed · Look closer | Safe · Unsafe · Dangerous · Danger | name the evidence, let the reader conclude |
| Not enough map data | No data = fine | a gap in the map is not a reassurance |
| Places to go | Safe spots, safe spaces | the place is a door and a light, not a guarantee |
| Reports · crime reports | Incidents (on the map) | a report is what somebody entered |
| Police figures · recorded offences | Crime rate, danger level | per neighbourhood, and reporting moves it |
| Look closer | Avoid | the person decides |
| Lit · unlit · not mapped | Dark (for untagged) | untagged is not unlit |

The **tab** is still called *Safety*. *Safety* names the subject the tab explains, whereas *safe* would be a verdict about a street. See *Open questions*.

---

## 11. The Utrecht interview scenario

### 11.1 What it is

One controlled situation, the same for every participant, as asked: *"It's interactive but controlled by you what they're gonna see"* and *"if all participants are exposed to exactly the same scenario, exactly the same roads, exactly the same things … you see how different people react on the same information."*

| | |
|---|---|
| **Open it** | `https://maddie.arsaces.ir/?scenario=utrecht`, or *Or open the Utrecht study scenario* under an empty Route tab |
| **Start (A)** | Utrecht Centraal, station hall, fixed and not draggable |
| **Destinations (B)** | **Biltstraat**: 1.7 km through the centre · **Overvecht**: 3 km, student housing, past the railway · **Utrecht Science Park**: 4.6 km, the campus |
| **Ways round** | up to three per destination per mode, recorded from OSRM. Where OSRM offers only one, extra routes are forced through a named street (Domplein; the Wittevrouwensingel; the Griftpark; the Amsterdamsestraatweg; the Wilhelminapark; the Biltstraat), so there is always something to compare |
| **Modes** | walking and cycling (driving is disabled, *"Not part of the study scenario"*) |
| **Hour** | opens at **22:00**; the participant can move it, and every route is re-read instantly |
| **Map data** | routes, the per-point reads behind each reading, places to go, lamps and lit streets, all **recorded once** (`npm run scenario`) into `src/lib/scenario-recording.json` and replayed. No rate limit, slow proxy or changed tag can make participant 14 see something different from participant 3, and the session needs no network beyond the map tiles |
| **Reports** | 70 invented reports in ten Utrecht districts, spread over 18 months, from a fixed clock, identical every session. Never sent to the server. A report a participant adds stays in that session only |
| **Labelling** | a *Study scenario* chip in the trip card throughout. Its ⓘ says everyone sees the same thing, when the data was recorded, and that the reports were prepared for the session and describe nothing that happened |

### 11.2 A session plan that fits the tool (for discussion with Evanthea)

Following the structure suggested in the first meeting (*experience first, then explore, then a task*):

1. **Before the screen:** a time they chose a way home and why, what made them feel at ease or not.
2. **Explore (5 min):** open the scenario, choose any destination, play. No instruction beyond *"think aloud"*.
3. **Task:** *"It is 22:00, you are at Utrecht Centraal and you are walking to Overvecht. Which way would you go, and why?"*
4. **Vary:** move the hour to 01:00 and to 18:00; switch to cycling; switch a factor off in Layers; open Reports. Does the choice change?
5. **Close:** what was missing, what was confusing, what they would add.

Every participant gets the same three destinations and the same reports, so differences in choice are differences in people.

### 11.3 Before real participants

The prepared reports are realistic so that they can start a discussion, but they are invented. Do not quote any count or sentence from them. Re-record (`npm run scenario`) only **between** rounds, never between sessions, and commit the file.

---

## 12. Decisions, and why

| Decision | Reason |
|---|---|
| Purple retired from the map entirely, not just from the routes | It had four meanings. Removing it removes the chance of it coming back with a second. |
| No red | *"You don't need to use the red color to show danger."* The far end of the scale is rust, which reads as "look closer". |
| A and B achromatic | Colour is for evidence. The start *"can be just gray"*. B is the heavier mark because it is the one you have to find. |
| UI accent is ink, not a hue | Every hue now belongs to the map, so a purple Preferred tag would be a fifth meaning. |
| Light as a **glow** around the route, not a coloured line | Light spreads, so it reads without a key, and it leaves the line's colour free for the overall reading: *"one can be a color and the other can be opacity … as an outline of the line."* |
| Route scale teal → orange → rust | Colour-blind safe, no red, no purple, distinct in greyscale |
| Grey + dashed = not known (including loading) | *"Because it's uncertainty."* One statement, one look |
| Police figures as **hatch** | It is an area statistic, and texture is the one channel nothing else uses. It says *"the whole area"* before the popup opens. |
| One pink heart, kind on demand | *"My default view is just this pink safe space thing … hover … you see the exact icons."* |
| Reports blue speech bubbles, faded by age | A voice, not an alarm. Not *"too scary, stay home"*. Age is the reader's judgement, so it is shown, not filtered |
| Reports and police figures **beside** the reading, never in it | The reading compares routes street by street; neither source can. Counts per route make the connection the supervisor asked for without hiding a weight inside the number. |
| The preferred route is on the map, first in the list, and in the peek row | *"You're not recommending me something … make clear … one of them is what I recommend."* |
| Four tabs by task; Research moved off the tab bar | *"Have a logic behind the packaging."* The research view is not something a participant consults. |
| Night darkens the **map**, driven by the hour | *"It does nothing to the map."* Now the map is the night view. |
| Layers re-score instantly, nothing fetched | *"Every time I remove [something] everything is recomputed and I see different things on the map."* |
| Controlled, recorded scenario | *"Interactive but controlled by you."* Identical for every participant, and works offline. |

---

## 13. Open questions for the supervisors

1. **Should reports count in the reading?** They are shown beside it, counted per route, and never weighted into the number (reasons in §3.2). If the supervisors want them in, it could be a sixth factor in Layers, off by default and labelled as such.
2. **Is the tab name *Safety* acceptable?** It names the subject the tab explains, not a verdict about a street. The alternative is *Why*.
3. **Orange for *Mixed*.** It is distinct from the yellow glow (hue 27° against 50°, and a solid line against a soft halo), but the two are neighbours. A participant confusing them would be a finding.
4. **Age thresholds** (3 months / 1 year) and the **75 m** "along the route" radius are judgement calls, worth asking participants about.
5. **Places to go as a factor.** Today places are shown and counted per route but do not move the reading. The supervisor's example (*"remove police station … everything is recomputed"*) suggests they might.

---

## 14. Where each part lives in the code

| Element | File |
|---|---|
| Every colour, with its one meaning | `src/lib/palette.ts` (mirrored as CSS tokens in `src/app/globals.css`) |
| Reading labels and one-line meanings | `src/lib/verdict.ts` |
| What counts (the five factors) | `src/lib/score.ts` (`FACTORS`, `assess(…, factors)`) |
| What sits beside a route | `src/lib/alongside.ts` |
| The map and its layers, bottom to top | `src/components/MapCanvas.tsx` |
| The legend | `src/components/Legend.tsx` |
| Route / Safety / Layers / Reports | `RouteChoices.tsx` + `RoutePlanner.tsx` · `SafetyPanel.tsx` · `LayersPanel.tsx` · `ReportsPanel.tsx` |
| The scenario | `src/lib/scenario.ts`, `scripts/scenario.ts`, `src/lib/scenario-recording.json` |
| The rules, as tests | `test/palette.test.ts`, `test/factors.test.ts`, `test/scenario.test.ts` |
