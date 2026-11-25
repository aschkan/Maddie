"use client";

/**
 * "Plan a route" — the LANDING page (`/`). From the supervisor meeting of
 * 4 Nov 2026: "You should start the tool with the easy thing … when I saw the
 * three routes, this was a sign. This works well." No tutorial: the three
 * routes are meant to say what the tool is for on their own.
 *
 * Kept as it was, per both supervisors: the route comparison and "where do
 * the differences occur". Removed: the radar and the factor table — the same
 * numbers twice more ("the table is nice … but I don't need the list because
 * you already have the numbers in the plot"). Added: a CROWD factor (busy
 * streets, and bars as their own kind of crowd), parks in green, report dots
 * shaded by how serious they read, and every story in a stretch, readable.
 *
 * Three routes, NO SCORE, and no route recommended — "that's their decision"
 * (meeting of 25 Nov 2026). The routes differ by colour only; a selected one
 * by opacity. "The routes in numbers" is bars (absolute values) and one 100%
 * bar for lighting, under group headers named and ordered exactly like the
 * timeline below it ("Compare the routes along the way"). One legend, between
 * the map and the comparison, says what every mark means. The map and the
 * timeline are COORDINATED: tap a route and the timeline marks that point;
 * move along the timeline and the map's cursor follows.
 *
 * The trade-off slider FILTERS — a route over the time budget is set aside —
 * and never re-scores. "Route B is best on lighting and worst on parkland" is
 * the thing a single number would have hidden, and hiding it is the failure
 * this board exists to avoid.
 *
 * Routes come from the study RECORDING when the trip is one of Utrecht's
 * scenario trips (no network at all — `scenario.ts`), and live from OSRM and
 * Overpass, through this server, otherwise.
 */

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Bike, CalendarDays, Car, ChevronDown, Clock, Footprints, ExternalLink } from "lucide-react";

import { SOURCE_LABEL } from "@/lib/reports";
import BoardHeader, { Sources } from "@/components/BoardHeader";
import { FactorBars, Swatch, type FactorColumn } from "@/components/charts";
import { useEvidence } from "@/components/EvidenceProvider";
import ImportancePanel, { RankDot } from "@/components/ImportancePanel";
import PlaceField from "@/components/PlaceField";
import RouteChip from "@/components/RouteChip";
import Story from "@/components/Story";
import Timeline from "@/components/Timeline";
import { PLACE_KINDS, useLiveLayers, useRecording } from "@/components/useMapData";
import { useRouteFacts } from "@/components/useRouteFacts";
import type { City, TripEnd } from "@/lib/cities";
import { lightAt } from "@/lib/daylight";
import {
  CROWD_KINDS, routeEvidence, routeLetter, subPath, summariseInterval, withinBudget, type RouteEvidence,
} from "@/lib/evidence";
import { boundsAround, distanceM } from "@/lib/geo";
import { googleMapsLink } from "@/lib/handoff";
import { EMPTY_LAYERS } from "@/lib/layers";
import { fetchRoutes, type LatLng, type Profile, type Route } from "@/lib/osrm";
import type { SampleRead } from "@/lib/overpass";
import { pick, ROUTE_INK } from "@/lib/palette";
import { rankOf } from "@/lib/importance";
import { recordedLeg, SCENARIO_DESTINATIONS, SCENARIO_PROFILES, SCENARIO_START } from "@/lib/scenario";

const CompareMap = dynamic(() => import("@/components/CompareMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading the map…</div>,
});

const MAX_ROUTES = 3;
const NO_ROUTES: Route[] = [];
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);
const MODES: { id: Profile; label: string; Icon: typeof Footprints }[] = [
  { id: "walking", label: "Walk", Icon: Footprints },
  { id: "cycling", label: "Cycle", Icon: Bike },
  { id: "driving", label: "Drive", Icon: Car },
];
const LIGHT_WORD = { day: "daylight", twilight: "dusk", night: "after dark" } as const;

const same = (a: TripEnd, b: TripEnd) => distanceM(a.point, b.point) < 30;

/** A point set on the map has no name until somebody searches; say where it is. */
const pinLabel = (point: LatLng) => `Pin ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;

export default function CompareBoard() {
  const { city } = useEvidence();
  return <CompareFor key={city.id} city={city} />;
}

function CompareFor({ city }: { city: City }) {
  const ev = useEvidence();
  const [from, setFrom] = useState<TripEnd>(city.trip.from);
  const [to, setTo] = useState<TripEnd>(city.trip.to);
  const [profile, setProfile] = useState<Profile>("walking");
  const [departure, setDeparture] = useState("21:00");
  const [date, setDate] = useState("2026-10-09");
  const [showReports, setShowReports] = useState(true);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const [brush, setBrush] = useState<[number, number] | null>([0.4, 0.55]);
  const [extra, setExtra] = useState(10);
  const [tilesOk, setTilesOk] = useState(true);
  const [placing, setPlacing] = useState<"A" | "B">("A");
  const [showCrowd, setShowCrowd] = useState(false);
  const [shadeOpen, setShadeOpen] = useState(false);

  /** A tap or a drag on the map: that end moves, and the next tap sets the other. */
  function place(letter: "A" | "B", point: LatLng) {
    const end = { label: pinLabel(point), point };
    if (letter === "A") setFrom(end);
    else setTo(end);
    setSelected(0);
    setCursor(null);
    setPlacing(letter === "A" ? "B" : "A");
  }

  function selectRoute(index: number) {
    if (index !== selected) setCursor(null);
    setSelected(index);
  }

  // The date is read in the browser: the page is prerendered, and a date
  // computed during that render is the build machine's.
  useEffect(() => {
    void (async () => {
      const now = new Date();
      setDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
    })();
  }, []);

  /* ── where the routes come from ─────────────────────────────────────── */
  const presets: TripEnd[] = city.scenario
    ? [SCENARIO_START, ...SCENARIO_DESTINATIONS].map((place) => ({ label: place.label, point: place.point }))
    : [city.trip.from, city.trip.to];
  const scenarioLeg = city.scenario && same(from, SCENARIO_START) && SCENARIO_PROFILES.includes(profile)
    ? SCENARIO_DESTINATIONS.find((place) => same(to, place)) ?? null
    : null;
  const { recording, error: recordingError } = useRecording(city.scenario);
  const recorded = useMemo(
    () => (scenarioLeg ? recordedLeg(recording, scenarioLeg.id, profile).slice(0, MAX_ROUTES) : []),
    [scenarioLeg, recording, profile],
  );

  const [liveRoutes, setLiveRoutes] = useState<Route[]>([]);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      if (scenarioLeg) {
        setLiveRoutes([]);
        setRouteError(null);
        setRouting(false);
        return;
      }
      setRouting(true);
      const result = await fetchRoutes(from.point, to.point, profile, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setRouting(false);
      if (result.ok) {
        setLiveRoutes(result.routes.slice(0, MAX_ROUTES));
        setRouteError(null);
      } else {
        setLiveRoutes([]);
        setRouteError(result.error === "cancelled" ? null : result.error);
      }
    })();
    return () => controller.abort();
  }, [from, to, profile, scenarioLeg]);

  const live = useRouteFacts(scenarioLeg ? NO_ROUTES : liveRoutes);
  const routes: Route[] = scenarioLeg ? recorded : liveRoutes;
  const reads: (SampleRead[] | null)[] = scenarioLeg ? recorded.map((route) => route.reads) : live.reads;

  const routeBox = useMemo(() => boundsAround(routes.flatMap((route) => route.path), 150), [routes]);
  const liveLayers = useLiveLayers(scenarioLeg ? null : routeBox, [...PLACE_KINDS, ...CROWD_KINDS], true);
  const layers = scenarioLeg ? recording?.layers ?? EMPTY_LAYERS : liveLayers.layers;
  const spots = useMemo(() => layers.spots.filter((spot) => PLACE_KINDS.includes(spot.kind)), [layers.spots]);
  const crowdSpots = useMemo(() => layers.spots.filter((spot) => CROWD_KINDS.includes(spot.kind)), [layers.spots]);
  const reports = useMemo(() => (showReports ? ev.reports : []), [showReports, ev.reports]);
  // Where lighting was loaded. Nothing is drawn outside it, so it is outlined.
  const lightArea = useMemo(
    () => (scenarioLeg ? boundsAround(layers.litWays.flatMap((way) => way.path), 0) : routeBox),
    [scenarioLeg, layers.litWays, routeBox],
  );

  /* ── each route, decomposed ─────────────────────────────────────────── */
  const evidence = useMemo<(RouteEvidence | null)[]>(
    () => routes.map((route, i) => (reads[i] ? routeEvidence(route, reads[i], spots, reports, crowdSpots) : null)),
    [routes, reads, spots, reports, crowdSpots],
  );
  const minutes = routes.map((route) => route.seconds / 60);
  const kept = withinBudget(minutes, extra);
  const hidden = kept.map((k) => !k);
  const chosen = Math.min(selected, Math.max(0, routes.length - 1));
  const chosenEvidence = evidence[chosen] ?? null;
  const chosenRoute = routes[chosen];

  // Tell the other boards which route is selected — Explore measures to it.
  const routeKey = chosenRoute ? `${chosen}|${chosenRoute.path.length}|${from.label}|${to.label}` : "";
  useEffect(() => {
    void (async () => {
      if (!chosenRoute) return;
      ev.setRoute({ cityId: city.id, label: `Route ${routeLetter(chosen)}, ${from.label} to ${to.label}`, path: chosenRoute.path });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- routeKey captures the route
  }, [routeKey]);

  const summary = chosenEvidence && brush ? summariseInterval(chosenEvidence, brush[0], brush[1]) : null;
  const highlight = useMemo(
    () => (chosenRoute && brush ? subPath(chosenRoute.path, brush[0], brush[1]) : []),
    [chosenRoute, brush],
  );

  const inks = routes.map((_, i) => pick(ROUTE_INK[i] ?? ROUTE_INK[2]!, ev.tone));
  const nearReports = useMemo(() => {
    const ids = new Set(evidence.flatMap((e) => e?.reports.map((mark) => mark.item.id) ?? []));
    return reports.filter((report) => ids.has(report.id));
  }, [evidence, reports]);
  const nearCrowd = useMemo(() => {
    const ids = new Set(evidence.flatMap((e) => [...(e?.busy ?? []), ...(e?.nightlife ?? [])].map((mark) => mark.item.id)));
    return crowdSpots.filter((spot) => ids.has(spot.id));
  }, [evidence, crowdSpots]);
  const nearPlaces = useMemo(() => {
    const ids = new Set(evidence.flatMap((e) => e?.places.map((mark) => mark.item.id) ?? []));
    return spots.filter((spot) => ids.has(spot.id));
  }, [evidence, spots]);

  const count = (of: (e: RouteEvidence) => number) => evidence.map((e) => (e ? of(e) : null));
  // Same groups, same names, same order as the timeline's tracks (`TRACKS`).
  const columns: FactorColumn[] = [
    { group: "Duration", title: "Minutes, start to destination", kind: "bar", values: routes.map((_, i) => minutes[i] ?? null), unit: " min" },
    { group: "Lighting", title: "Share of the route: lit · unlit · unknown", kind: "lighting", shares: evidence.map((e) => (e ? { lit: e.litPct, unlit: e.unlitPct, unknown: e.unknownPct } : null)) },
    { group: "Places to go in", title: "Within 100 m", kind: "bar", values: count((e) => e.places.length) },
    {
      group: "Reported places", title: "Within 75 m", kind: "bar", values: count((e) => e.reports.length),
      hiddenNote: showReports ? undefined : "Hidden — you switched them off",
    },
    { group: "Crowd", title: "Busy streets & squares", kind: "bar", values: count((e) => e.busy.length) },
    { group: "Crowd", title: "Bars, pubs & cafés", kind: "bar", values: count((e) => e.nightlife.length) },
    { group: "Parks & underpasses", title: "Through parks (m)", kind: "bar", values: count((e) => e.parklandM) },
    { group: "Parks & underpasses", title: "Underpasses", kind: "bar", values: count((e) => e.underpasses.length) },
  ];

  const sky = useMemo(() => {
    const at = new Date(`${date}T${departure}:00`);
    return Number.isFinite(at.getTime()) ? lightAt(at, from.point) : null;
  }, [date, departure, from.point]);

  const handoff = chosenRoute ? googleMapsLink(chosenRoute.path, profile) : null;
  const mode = MODES.find((m) => m.id === profile) ?? MODES[0]!;
  const reading = routes.length > 0 && evidence.some((e) => e === null);

  return (
    <main className="board compare">
      <BoardHeader
        title="Plan a route"
        note={<>Three different ways from your start to your destination, side by side: how lit, how busy, what is nearby, what people reported. None of them is recommended and there is no <b>overall score</b> — you decide.</>}
      />

      {/* ── the trip ────────────────────────────────────────────────── */}
      <section className="card trip-bar" aria-label="Trip">
        <PlaceField label="Start" value={from} presets={presets} onPick={(end) => { setFrom(end); setSelected(0); setCursor(null); }} />
        <PlaceField label="Destination" value={to} presets={presets} onPick={(end) => { setTo(end); setSelected(0); setCursor(null); }} />
        <div className="trip-field">
          <label htmlFor="mode">Travel mode</label>
          <div className="trip-input">
            <mode.Icon size={16} aria-hidden />
            <select id="mode" value={profile} onChange={(e) => setProfile(e.target.value as Profile)}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden className="chev" />
          </div>
        </div>
        <div className="trip-field">
          <label htmlFor="departure">Departure</label>
          <div className="trip-input">
            <Clock size={16} aria-hidden />
            <select id="departure" value={departure} onChange={(e) => setDeparture(e.target.value)}>
              {HOURS.map((hour) => <option key={hour}>{hour}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden className="chev" />
          </div>
          {sky && <small className="trip-hint">{LIGHT_WORD[sky]} at {from.label}</small>}
        </div>
        <div className="trip-field">
          <label htmlFor="date">Date</label>
          <div className="trip-input">
            <CalendarDays size={16} aria-hidden />
            <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value || date)} />
          </div>
        </div>
        <div className="trip-field wide">
          <span className="trip-label">Reported places</span>
          <label className="check reports-switch">
            <input type="checkbox" checked={showReports} onChange={() => setShowReports(!showReports)} />
            <span>Show places people reported{city.scenario ? ` (${city.name})` : ""}</span>
          </label>
          <small className="trip-hint">Streets, lighting and places always come from OpenStreetMap.</small>
        </div>
      </section>

      <div className="compare-grid">
        {/* ── map ─────────────────────────────────────────────────────── */}
        <section className="card map-card compare-map">
          <div className="map-wrap">
            <CompareMap
              tone={ev.tone}
              centre={city.centre}
              from={from}
              to={to}
              routes={routes}
              hidden={hidden}
              selected={chosen}
              onSelect={selectRoute}
              highlight={highlight}
              litWays={layers.litWays}
              places={nearPlaces}
              reports={nearReports}
              crowd={showCrowd ? nearCrowd : []}
              order={ev.order}
              onTiles={setTilesOk}
              placing={placing}
              onPlace={place}
              lightArea={lightArea}
              cursor={cursor}
              onCursor={(route, at) => { setSelected(route); setCursor(at); setBrush([Math.max(0, at - 0.03), Math.min(1, at + 0.03)]); }}
            />
            <div className="map-place" role="group" aria-label="Tap the map to set">
              <span>Tap map to set</span>
              {([["A", "Start"], ["B", "Destination"]] as const).map(([letter, word]) => (
                <button key={letter} type="button" aria-pressed={placing === letter} onClick={() => setPlacing(letter)}>
                  {word}
                </button>
              ))}
            </div>
            <span className="north" aria-hidden>N<br />▲</span>
            {!tilesOk && <p className="map-banner">The basemap did not load — the routes are still drawn.</p>}
            {routing && <p className="map-banner">Asking for routes…</p>}
            {routeError && <p className="map-banner warn">{routeError}</p>}
            {recordingError && <p className="map-banner warn">{recordingError}</p>}
          </div>
          {handoff && (
            <a className="handoff" href={handoff.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> {mode.label} <RouteChip index={chosen} /> in Google Maps — the route travels as {handoff.waypoints} waypoints; the evidence stays here
            </a>
          )}
        </section>

        {/* ── the routes in numbers ───────────────────────────────────── */}
        <section className="card factors">
          <div className="card-head"><h2>The routes in numbers</h2></div>
          <p className="card-sub">The totals for each whole route, from start to destination. Tap a route to follow it on the map and in the comparison below.</p>
          {routes.length === 0 ? (
            <p className="empty">{routing ? "Asking for routes…" : "No routes yet — pick a start and a destination above."}</p>
          ) : (
            <FactorBars
              columns={columns}
              routes={routes.length}
              inks={inks}
              muted={hidden}
              selected={chosen}
              onPick={selectRoute}
              chip={(i) => <RouteChip index={i} on={i === chosen} note={hidden[i] ? "over the time budget" : undefined} />}
            />
          )}
          {hidden.some(Boolean) && <p className="note">Faded: over the time budget you set (Explore trade-offs).</p>}
          {reading && <p className="note">Reading what OpenStreetMap records along each route…</p>}
          {live.error && !scenarioLeg && <p className="note warn">{live.error}</p>}
        </section>

        {/* ── one legend, for the map and the comparison ──────────────── */}
        <section className="card compare-legend" aria-label="What the marks mean">
          <h2>What the marks mean</h2>
          <div className="legend-grid">
            <div className="legend-group">
              <h3>Routes</h3>
              <span className="legend-row">
                {routes.map((_, i) => <RouteChip key={i} index={i} on={i === chosen} onClick={() => selectRoute(i)} />)}
              </span>
              <span className="legend-row">Three different ways from start to destination, in no order of preference. The one you picked is solid; the others are a little faded.</span>
              <span className="legend-row"><span className="cursor-swatch" aria-hidden /> The point you tapped on a route — the comparison below marks the same point.</span>
            </div>
            <div className="legend-group">
              <h3>Lighting</h3>
              <span className="legend-row"><i className="sw sw-line" style={{ background: "var(--lit)" }} /> Lit — street lighting is mapped</span>
              <span className="legend-row"><Swatch colour="var(--unlit)" /> Unlit — mapped as having no lighting</span>
              <span className="legend-row"><Swatch colour="" hatch /> Unknown lighting — nobody has mapped it</span>
              <span className="legend-row"><span className="area-swatch" aria-hidden /> The area where lighting is drawn</span>
              <small className="legend-note">On the map only <b>lit</b> streets are drawn, and only inside the dashed outline — outside it nothing was loaded. Unlit and unknown lighting are shown in the comparison below, not on the map.</small>
            </div>
            <div className="legend-group">
              <h3>Places to go in</h3>
              <span className="legend-row"><span className="heart">♥</span> A station, shop, pharmacy… — a door to go in, usually with people</span>
            </div>
            <div className="legend-group">
              <h3>Reported places</h3>
              <span className="legend-row">
                <span className="rank-ramp">{[0, 1, 2, 3, 4].map((r) => <RankDot key={r} rank={r} />)}</span>
                A place a woman reported in Pointer&apos;s survey, with why. Darker = more serious. Tap a dot to read it.
              </span>
              {!showReports && <small className="legend-note struck-note">Hidden: you switched reported places off above. They are still there.</small>}
              <button type="button" className="section-toggle" onClick={() => setShadeOpen(!shadeOpen)} aria-expanded={shadeOpen}>
                <span>What each shade means</span>
                <ChevronDown size={16} aria-hidden className={shadeOpen ? "flip" : undefined} />
              </button>
              {shadeOpen && <ImportancePanel compact />}
            </div>
            <div className="legend-group">
              <h3>Crowd</h3>
              <span className="legend-row"><span className="crowd-mark">+</span> Busy street or square</span>
              <span className="legend-row"><span className="bar-mark" /> Bar, pub or café — a crowd, but not every crowd feels the same</span>
              <label className="check legend-row">
                <input type="checkbox" checked={showCrowd} onChange={() => setShowCrowd(!showCrowd)} />
                <span>Show them on the map too</span>
              </label>
            </div>
            <div className="legend-group">
              <h3>Parks &amp; underpasses</h3>
              <span className="legend-row"><Swatch colour="var(--park)" /> Through a park</span>
              <span className="legend-row"><span className="arch" aria-hidden>∩</span> Underpass (under a bridge or road)</span>
              <small className="legend-note">In the comparison below only.</small>
            </div>
          </div>
        </section>

        {/* ── timeline ────────────────────────────────────────────────── */}
        <section className="card timeline-card">
          <div className="card-head">
            <h2>Compare the routes along the way</h2>
            <span className="card-hint">Move along a route to see that point on the map; drag to look at one stretch.</span>
          </div>
          <p className="card-sub">Each route from start (0) to destination (100%), in the same order as the numbers above: lighting, places to go in, reported places, crowd, and parks &amp; underpasses.</p>
          {routes.length > 0 && (
            <Timeline
              evidence={evidence}
              inks={inks}
              hidden={hidden}
              selected={chosen}
              onSelect={selectRoute}
              brush={brush}
              onBrush={setBrush}
              rankOf={(report) => rankOf(report, ev.order)}
              cursor={cursor}
              onCursor={setCursor}
              reportsHidden={!showReports}
            />
          )}
        </section>

        {/* ── the brushed interval, and the trade-off ─────────────────── */}
        <div className="side-stack">
          <section className="card interval">
            <h2 className="interval-title">Selected stretch <RouteChip index={chosen} /></h2>
            {!brush || !summary ? (
              <p className="note">Drag across the tracks of <RouteChip index={chosen} /> to choose a stretch.</p>
            ) : (
              <>
                <p className="card-sub">{Math.round(Math.min(...brush) * 100)}–{Math.round(Math.max(...brush) * 100)}% of the way</p>
                <div className="interval-box">
                  <dl>
                    <dt>Lighting:</dt><dd>{summary.lighting}</dd>
                    <dt>Places to go in:</dt><dd>{summary.places === 0 ? "none nearby" : `${summary.places} · opening hours: ${summary.openingHours}`}</dd>
                    <dt>Reported places:</dt><dd>{showReports ? summary.reports : <span className="struck-note">hidden — switched off above</span>}</dd>
                    <dt>Crowd:</dt><dd>{summary.crowd}</dd>
                  </dl>
                  <h3>What people said here</h3>
                  {!showReports ? (
                    <p className="note">Reported places are switched off, so their stories are hidden too.</p>
                  ) : summary.stories.length > 0 ? (
                    <ul className="stories">
                      {summary.stories.map((story) => (
                        <li key={story.id}>
                          <p className="narrative-label">{SOURCE_LABEL[story.source]}{story.place ? `, ${story.place}` : ""}:</p>
                          <Story text={story.note ?? ""} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="note">No respondent shared a story about this stretch.</p>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="card tradeoff">
            <h2>Explore trade-offs <span className="muted">(optional)</span></h2>
            <label className="slider">
              <span>Maximum extra time:</span>
              <b>{extra} min</b>
              <input type="range" min={0} max={30} value={extra} onChange={(e) => setExtra(Number(e.target.value))} />
            </label>
            <p className="note">Fades routes that take longer than this; does not rank them.</p>
          </section>
        </div>
      </div>

      <p className="caveat">Progress along a route lines the three up; their lengths differ. Reported places are context; nothing here adds the factors up or recommends a route.</p>
      <Sources />
    </main>
  );
}
