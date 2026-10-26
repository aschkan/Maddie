"use client";

/**
 * Board 02 — "Compare route evidence". `docs/reference/board-02-compare.webp`
 * is the picture it is built to; `docs/Maddie-Evidence-Dashboard.md` the spec.
 *
 * Three routes, five factors, NO SCORE. One dot plot per factor, one row per
 * route, so the eye crosses a row to see one route and runs down a column to
 * see one factor (Franconeri: compare several items on several axes → small
 * multiples of dot plots). Below, where along each route the differences sit.
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
import { Bike, CalendarDays, Car, ChevronDown, Clock, Database, Footprints, ExternalLink } from "lucide-react";

import { SOURCE_LABEL } from "@/lib/reports";
import BoardHeader, { Sources } from "@/components/BoardHeader";
import { DotColumn, Key, Radar, Swatch } from "@/components/charts";
import { useEvidence } from "@/components/EvidenceProvider";
import PlaceField from "@/components/PlaceField";
import Timeline from "@/components/Timeline";
import { PLACE_KINDS, useLiveLayers, useRecording } from "@/components/useMapData";
import { useRouteFacts } from "@/components/useRouteFacts";
import type { City, TripEnd } from "@/lib/cities";
import { lightAt } from "@/lib/daylight";
import {
  niceMax, routeEvidence, routeLetter, subPath, summariseInterval, withinBudget, type RouteEvidence,
} from "@/lib/evidence";
import { boundsAround, distanceM } from "@/lib/geo";
import { googleMapsLink } from "@/lib/handoff";
import { EMPTY_LAYERS } from "@/lib/layers";
import { fetchRoutes, type Profile, type Route } from "@/lib/osrm";
import type { SampleRead } from "@/lib/overpass";
import { pick, ROUTE_DASH, ROUTE_INK } from "@/lib/palette";
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

type Source = "osm+reports" | "osm";

const same = (a: TripEnd, b: TripEnd) => distanceM(a.point, b.point) < 30;

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
  const [source, setSource] = useState<Source>("osm+reports");
  const [selected, setSelected] = useState(0);
  const [brush, setBrush] = useState<[number, number] | null>([0.4, 0.55]);
  const [extra, setExtra] = useState(10);
  const [tilesOk, setTilesOk] = useState(true);

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
  const liveLayers = useLiveLayers(scenarioLeg ? null : routeBox, PLACE_KINDS, true);
  const layers = scenarioLeg ? recording?.layers ?? EMPTY_LAYERS : liveLayers.layers;
  const spots = useMemo(() => layers.spots.filter((spot) => PLACE_KINDS.includes(spot.kind)), [layers.spots]);
  const reports = useMemo(() => (source === "osm" ? [] : ev.reports), [source, ev.reports]);

  /* ── each route, decomposed ─────────────────────────────────────────── */
  const evidence = useMemo<(RouteEvidence | null)[]>(
    () => routes.map((route, i) => (reads[i] ? routeEvidence(route, reads[i], spots, reports) : null)),
    [routes, reads, spots, reports],
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
      ev.setRoute({ cityId: city.id, label: `Route ${routeLetter(chosen)}, ${from.label} → ${to.label}`, path: chosenRoute.path });
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
  const nearPlaces = useMemo(() => {
    const ids = new Set(evidence.flatMap((e) => e?.places.map((mark) => mark.item.id) ?? []));
    return spots.filter((spot) => ids.has(spot.id));
  }, [evidence, spots]);

  const factors = [
    { title: "Time (min)", values: evidence.map((e, i) => (routes[i] ? minutes[i]! : e?.minutes ?? null)), max: niceMax(Math.max(10, ...minutes) * 1.08) },
    { title: "Mapped lit (%)", values: evidence.map((e) => e?.litPct ?? null), max: 100 },
    { title: "Unknown lighting (%)", values: evidence.map((e) => e?.unknownPct ?? null), max: 100 },
    { title: "Nearby places (count)", values: evidence.map((e) => e?.places.length ?? null), max: niceMax(Math.max(5, ...evidence.map((e) => e?.places.length ?? 0))) },
    { title: "Parkland (m)", values: evidence.map((e) => e?.parklandM ?? null), max: niceMax(Math.max(100, ...evidence.map((e) => e?.parklandM ?? 0))) },
  ];
  const rowH = 52;

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
        title="Compare route evidence"
        note={<>Compare individual factors; there is no <b>overall safety score</b>.</>}
      />

      {/* ── the trip ────────────────────────────────────────────────── */}
      <section className="card trip-bar" aria-label="Trip">
        <PlaceField label="Starting point" letter="A" value={from} presets={presets} onPick={(end) => { setFrom(end); setSelected(0); }} />
        <PlaceField label="Destination" letter="B" value={to} presets={presets} onPick={(end) => { setTo(end); setSelected(0); }} />
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
          <label htmlFor="source">Data source</label>
          <div className="trip-input">
            <Database size={16} aria-hidden />
            <select id="source" value={source} onChange={(e) => setSource(e.target.value as Source)}>
              <option value="osm+reports">OpenStreetMap + community reports{city.scenario ? ` (${city.name})` : ""}</option>
              <option value="osm">OpenStreetMap only</option>
            </select>
            <ChevronDown size={16} aria-hidden className="chev" />
          </div>
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
              onSelect={setSelected}
              highlight={highlight}
              litWays={layers.litWays}
              places={nearPlaces}
              reports={nearReports}
              onTiles={setTilesOk}
            />
            <span className="north" aria-hidden>N<br />▲</span>
            <div className="map-key boxed">
              <span><span className="heart">♥</span> Nearby places</span>
              <span><i className="sw sw-line" style={{ background: "var(--lit)" }} /> Mapped lighting</span>
              <span><Swatch colour="var(--report)" round /> Community reports</span>
            </div>
            {!tilesOk && <p className="map-banner">The basemap did not load — the routes are still drawn.</p>}
            {routing && <p className="map-banner">Asking for routes…</p>}
            {routeError && <p className="map-banner warn">{routeError}</p>}
            {recordingError && <p className="map-banner warn">{recordingError}</p>}
          </div>
          {handoff && (
            <a className="handoff" href={handoff.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> {mode.label} Route {routeLetter(chosen)} in Google Maps — the route travels as {handoff.waypoints} waypoints; the evidence stays here
            </a>
          )}
        </section>

        {/* ── dot plots ───────────────────────────────────────────────── */}
        <section className="card factors">
          <div className="card-head"><h2>Route comparison (individual factors)</h2></div>
          {routes.length === 0 ? (
            <p className="empty">{routing ? "Asking for routes…" : "No routes yet — pick a start and a destination above."}</p>
          ) : (
            <div className="dot-grid" style={{ ["--rows" as string]: routes.length }}>
              <div className="dot-names" style={{ paddingTop: 34 + 22 }}>
                {routes.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    style={{ height: rowH }}
                    className={i === chosen ? "on" : undefined}
                    onClick={() => setSelected(i)}
                  >
                    {routeLetter(i)}
                  </button>
                ))}
              </div>
              {factors.map((factor) => (
                <DotColumn
                  key={factor.title}
                  title={factor.title}
                  max={factor.max}
                  rowH={rowH}
                  selected={chosen}
                  onPick={setSelected}
                  rows={factor.values.map((value, i) => ({ value, colour: inks[i]!, muted: hidden[i] }))}
                />
              ))}
            </div>
          )}
          {reading && <p className="note">Reading what OpenStreetMap records along each route…</p>}
          {live.error && !scenarioLeg && <p className="note warn">{live.error}</p>}
          {routes.length > 0 && (
            <Key items={routes.map((_, i) => ({
              swatch: <svg width="26" height="8" aria-hidden><line x1="1" x2="25" y1="4" y2="4" stroke={inks[i]} strokeWidth="3" strokeDasharray={ROUTE_DASH[i]} /></svg>,
              label: `Route ${routeLetter(i)}${hidden[i] ? " — over the time budget" : ""}`,
            }))} />
          )}
        </section>

        {/* ── timeline ────────────────────────────────────────────────── */}
        <section className="card timeline-card">
          <div className="card-head">
            <h2>Where do differences occur?</h2>
            <span className="card-hint">Brush a route interval to highlight its map segments.</span>
          </div>
          {routes.length > 0 && (
            <Timeline evidence={evidence} inks={inks} hidden={hidden} selected={chosen} onSelect={setSelected} brush={brush} onBrush={setBrush} />
          )}
          <Key items={[
            { swatch: <Swatch colour="var(--lit)" />, label: "Mapped lit (street lighting present)" },
            { swatch: <Swatch colour="var(--unlit)" />, label: "Mapped unlit" },
            { swatch: <Swatch colour="" hatch />, label: "Unknown lighting" },
            { swatch: <span className="heart">♥</span>, label: "Nearby place (e.g. station, shop, pharmacy)" },
            { swatch: <Swatch colour="var(--report)" round />, label: "Community report" },
            { swatch: <Swatch colour="var(--park)" />, label: "Park segment" },
            { swatch: <span className="arch" aria-hidden>∩</span>, label: "Underpass" },
          ]} />
        </section>

        {/* ── the brushed interval, and the trade-off ─────────────────── */}
        <div className="side-stack">
          <section className="card interval">
            <h2>Selected interval <span>· Route {routeLetter(chosen)}</span></h2>
            {!brush || !summary ? (
              <p className="note">Drag across Route {routeLetter(chosen)}&apos;s tracks to choose a stretch.</p>
            ) : (
              <>
                <p className="card-sub">{Math.round(Math.min(...brush) * 100)}–{Math.round(Math.max(...brush) * 100)}% of route</p>
                <div className="interval-box">
                  <dl>
                    <dt>Lighting:</dt><dd>{summary.lighting}</dd>
                    <dt>Place opening hours:</dt><dd>{summary.openingHours}</dd>
                    <dt>Mapped features:</dt><dd>OpenStreetMap</dd>
                    <dt>Reports:</dt><dd>{summary.reports}</dd>
                  </dl>
                  <h3>Qualitative experience</h3>
                  {summary.narrative ? (
                    <>
                      <p className="narrative-label">{SOURCE_LABEL[summary.narrative.source]}{summary.narrative.place ? `, ${summary.narrative.place}` : ""}:</p>
                      <q className="narrative">{summary.narrative.note}</q>
                    </>
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
            <p className="note">Filters route options; does not re-score.</p>
          </section>
        </div>
      </div>

      {/* ── more views: what the team asked for after the mockups ────── */}
      {routes.length > 0 && <>
      <h2 className="section-title">The same factors, another shape</h2>
      <div className="more-grid">
        <section className="card span-2">
          <div className="card-head"><h2>Every route on every factor</h2></div>
          <p className="card-sub">
            A radar of the five factors above, plus reports nearby. Each axis has its OWN scale, from zero to the
            largest value among these routes — so the shape is a profile, not a score. A bigger polygon is not a
            better route; read each spoke on its own.
          </p>
          {routes.length > 0 && (
            <Radar
              axes={[
                ...factors.map((factor) => ({ label: factor.title, max: factor.max })),
                { label: "Reports nearby", max: niceMax(Math.max(3, ...evidence.map((e) => e?.reports.length ?? 0))) },
              ]}
              series={routes.map((_, i) => ({
                label: `Route ${routeLetter(i)}`,
                values: [...factors.map((factor) => factor.values[i] ?? null), evidence[i]?.reports.length ?? null],
                colour: inks[i]!,
                dash: ROUTE_DASH[i],
                muted: hidden[i],
              }))}
              selected={chosen}
              onPick={setSelected}
            />
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>The factors, as numbers</h2></div>
          <table className="factor-table">
            <thead>
              <tr><th />{routes.map((_, i) => <th key={i} className={i === chosen ? "on" : undefined}>{routeLetter(i)}</th>)}</tr>
            </thead>
            <tbody>
              {[...factors.map((factor) => ({ title: factor.title, values: factor.values })),
                { title: "Mapped unlit (%)", values: evidence.map((e) => e?.unlitPct ?? null) },
                { title: "Underpasses", values: evidence.map((e) => e?.underpasses.length ?? null) },
                { title: "Reports nearby", values: evidence.map((e) => e?.reports.length ?? null) },
                { title: "Length (km)", values: evidence.map((e) => (e ? e.lengthM / 1000 : null)) },
              ].map((row) => (
                <tr key={row.title}>
                  <th>{row.title}</th>
                  {row.values.map((value, i) => (
                    <td key={i} className={i === chosen ? "on" : undefined}>
                      {value === null ? "…" : row.title.startsWith("Length") ? value.toFixed(1) : Math.round(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">No column adds these up. Reports are counted within 75 m and places within 100 m of the line.</p>
        </section>
      </div>
      </>}

      <p className="caveat">Route progress aligns relative position; distances differ. Marked places are context, not inputs to a route score.</p>
      <Sources />
    </main>
  );
}
