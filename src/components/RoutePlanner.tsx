"use client";

/**
 * The page: pick two points, get routes, compare them, and switch layers on.
 *
 * Built for a 360px phone and widened from there. The map is the page; the
 * trip card floats over the top of it and the panel is a sheet you drag up
 * from the bottom. From 900px the sheet becomes a sidebar — see `globals.css`,
 * where the only `min-width` query in the app lives.
 *
 * The panel's contents are three tabs rather than one long scroll, because the
 * scroll was six screens deep on a phone and the safety read — the thing the
 * page exists for — was four of them down.
 *
 * The map is imported with `ssr: false` and that has to happen from a CLIENT
 * component: `next/dynamic` refuses to disable SSR from a server component, and
 * Leaflet cannot be server-rendered at all — it touches `window` while the
 * module is still being evaluated.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import BottomSheet, { type Snap } from "@/components/BottomSheet";
import FilterPanel from "@/components/FilterPanel";
import RouteChoices from "@/components/RouteChoices";
import SafetyPanel from "@/components/SafetyPanel";
import TripCard from "@/components/TripCard";
import { useReports } from "@/components/useReports";
import { useRouteFacts } from "@/components/useRouteFacts";
import { compareRoutes } from "@/lib/compare";
import { plannedAt, type Light } from "@/lib/daylight";
import { isForwarded } from "@/lib/endpoints";
import type { Place } from "@/lib/geocode";
import { EMPTY_LAYERS, fetchLayers, gridStep, snapBox, type BBox, type LayerData } from "@/lib/layers";
import { fetchRoutes, PROFILES, type LatLng, type Profile, type Route } from "@/lib/osrm";
import { countExamples, CRIME_CATEGORIES, newReportId } from "@/lib/reports";
import { assess, lightingFor, type When } from "@/lib/score";
import { describeWorst, segmentRoute, worstStretch } from "@/lib/segments";
import { formatDistance, formatDuration } from "@/lib/format";
import { VERDICT_CLASS, VERDICT_LABEL } from "@/lib/verdict";

const MapCanvas = dynamic(() => import("@/components/MapCanvas"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading the map…</div>,
});

const AMSTERDAM: LatLng = { lat: 52.3728, lng: 4.8936 };

const PROFILE_LABEL: Record<Profile, string> = {
  driving: "Drive",
  walking: "Walk",
  cycling: "Cycle",
};

/** Written out rather than derived: "drive" + "ing" is "driveing". */
const PROFILE_TIME: Record<Profile, string> = {
  driving: "driving time",
  walking: "walking time",
  cycling: "cycling time",
};

/** What the hour you picked actually means, beside the clock reading. */
const LIGHT_WORD: Record<Light, string> = {
  day: "daylight",
  twilight: "dusk",
  night: "after dark",
};

type Tab = "route" | "safety" | "layers";

const TABS: { id: Tab; glyph: string; label: string }[] = [
  { id: "route", glyph: "🧭", label: "Route" },
  { id: "safety", glyph: "🔦", label: "Safety" },
  { id: "layers", glyph: "◉", label: "Layers" },
];

/**
 * Below this, the visible box is tens of kilometres across and the query for
 * it either times out or returns more than the map can usefully draw.
 */
const MIN_LAYER_ZOOM = 14;

/** Three is what OSRM offers; reading more than that is a slow page. */
const MAX_ROUTES = 3;

/**
 * How long to leave the layers alone after Overpass says it is rate limiting.
 *
 * A minute is roughly how long its window takes to roll. Asking again on the
 * next pan just holds the limit open — and spends the slot the route read
 * needs to say anything at all.
 */
const RATE_LIMIT_REST_MS = 60_000;

const THEME_KEY = "maddie.theme.v1";

/**
 * Whether the basemap comes through this server.
 *
 * It decides which half of the tile-failure message is true, and blaming the
 * wrong end sends whoever is debugging to the wrong machine.
 */
const tilesForwarded = isForwarded("tile");

export default function RoutePlanner() {
  const [start, setStart] = useState<LatLng | null>(null);
  const [end, setEnd] = useState<LatLng | null>(null);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [profile, setProfile] = useState<Profile>("walking");
  // The safety read turns almost entirely on whether it is dark, so the hour is
  // something you set rather than something the page assumes.
  const [hour, setHour] = useState<number>(() => new Date().getHours());

  const [routes, setRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  const [tab, setTab] = useState<Tab>("route");
  const [snap, setSnap] = useState<Snap>("peek");

  const [night, setNight] = useState(false);
  const [spots, setSpots] = useState<string[]>(["police", "hospital", "transit", "bar"]);
  const [lighting, setLighting] = useState(false);
  const [crime, setCrime] = useState<string[]>(() => CRIME_CATEGORIES.map((c) => c.id));
  const [reportMode, setReportMode] = useState(false);
  const [reportCategory, setReportCategory] = useState<string>(CRIME_CATEGORIES[0]?.id ?? "other");
  const { reports, backend, error: reportError, add, remove, clearExamples } = useReports();

  const [view, setView] = useState<{ bbox: BBox; zoom: number } | null>(null);
  const [layers, setLayers] = useState<LayerData>(EMPTY_LAYERS);
  const [layerError, setLayerError] = useState<string | null>(null);

  // So a slow reply for an old pair cannot overwrite a newer one.
  const inFlight = useRef<AbortController | null>(null);
  /**
   * The layer question already answered — snapped box, kinds, lighting.
   *
   * A pan that does not change it asks nothing at all.
   */
  const askedFor = useRef<string | null>(null);
  /**
   * Do not ask again until this moment.
   *
   * Set when Overpass says it is rate limiting us. Retrying into a limit on
   * every pan is what keeps the limit saturated — and every one of those
   * attempts also spends a slot the route read needs.
   */
  const [quietUntil, setQuietUntil] = useState(0);

  /* ── theme ──────────────────────────────────────────────────────────────
     Written onto <html> rather than kept in React alone, because Leaflet's own
     controls and the tile filter are styled by CSS that never sees props. */
  useEffect(() => {
    // In the IIFE like every other setState in this file: the React Compiler
    // lint rejects one reached synchronously from an effect body.
    void (async () => {
      let want = false;
      try {
        const saved = window.localStorage.getItem(THEME_KEY);
        want = saved
          ? saved === "dark"
          : window.matchMedia("(prefers-color-scheme: dark)").matches;
      } catch {
        want = true;
      }
      setNight(want);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = night ? "dark" : "light";
    try {
      window.localStorage.setItem(THEME_KEY, night ? "dark" : "light");
    } catch {
      // A browser that will not store a preference still gets the theme.
    }
  }, [night]);

  const dropReport = useCallback((point: LatLng) => {
    add({
      id: newReportId(Date.now(), Math.random()),
      category: reportCategory,
      point,
      at: new Date().toISOString(),
      source: "community",
    });
  }, [add, reportCategory]);

  /** A click drops A first, then B, then starts again from A. */
  const pick = useCallback((point: LatLng) => {
    const here = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
    setStart((currentStart) => {
      if (currentStart === null) {
        setStartText(here);
        return point;
      }
      setEnd((currentEnd) => {
        if (currentEnd === null) {
          setEndText(here);
          return point;
        }
        return currentEnd;
      });
      return currentStart;
    });
  }, []);

  /* ── routing ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    // Every setState lives inside this, including the "no pair yet" reset: the
    // React Compiler lint rejects one reached synchronously from an effect
    // body, because that is a second render before the first has painted.
    void (async () => {
      if (!start || !end) {
        setRoutes([]);
        setError(null);
        setBusy(false);
        return;
      }
      setBusy(true);
      const result = await fetchRoutes(start, end, profile, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setBusy(false);
      if (result.ok) {
        setRoutes(result.routes.slice(0, MAX_ROUTES));
        setSelected(0);
        setError(null);
        // There is something to read now, so show some of it. Half rather than
        // full: the point of the answer is where on the map it applies.
        setSnap((current) => (current === "peek" ? "half" : current));
      } else {
        setRoutes([]);
        // An abort is us replacing the request, not a failure worth showing.
        setError(result.error === "cancelled" ? null : result.error);
      }
    })();

    return () => controller.abort();
  }, [start, end, profile]);

  /* ── the read on each route ──────────────────────────────────────────── */
  const { facts, reads, done, error: factsError } = useRouteFacts(routes);

  /*
   * When and where the walk is.
   *
   * ONE point for every candidate route, not each route's own: the routes are
   * being compared against each other, and two of them judged under different
   * skies would differ by something that has nothing to do with the streets.
   * A few kilometres moves sunset by under a minute anyway.
   *
   * `at` is built here, in the browser, so "22:00" means the viewer's 22:00 —
   * the server's timezone is whatever the box was installed with.
   */
  const when = useMemo<When>(
    () => ({ hour, point: start ?? end, at: plannedAt(hour) }),
    [hour, start, end],
  );

  // Day, dusk or dark — shown beside the hour, so the control that moves the
  // score most says what it is doing before you read the verdict.
  const light = useMemo(() => lightingFor(when).light, [when]);

  // The hour changes the verdict but not the counts, so re-judging is free —
  // no second trip to OpenStreetMap.
  const assessments = useMemo(
    () => facts.map((found) => (found ? assess(found, when) : null)),
    [facts, when],
  );

  const comparison = useMemo(
    () => compareRoutes(routes, assessments),
    [routes, assessments],
  );

  /*
   * The selected route, cut into stretches and scored one by one.
   *
   * Same counts, finer grain: this is what colours the line on the map and
   * names the dark part, and it is recomputed from data already in hand — so
   * moving the hour slider re-cuts the whole route without a single request.
   */
  const segments = useMemo(() => {
    const read = reads[selected];
    return read ? segmentRoute(read, when) : [];
  }, [reads, selected, when]);

  const chosenScore = assessments[selected]?.score ?? null;
  const worst = useMemo(() => worstStretch(segments, chosenScore), [segments, chosenScore]);
  const worstLine = useMemo(() => describeWorst(worst, chosenScore), [worst, chosenScore]);

  /* ── the layers over the visible map ─────────────────────────────────── */
  const zoomedOut = view !== null && view.zoom < MIN_LAYER_ZOOM;

  useEffect(() => {
    const controller = new AbortController();

    // Panning fires this on every settle, and Overpass gives out a couple of
    // slots per IP. Waiting for the map to stand still is the difference
    // between one query and a 429 that also kills the route read.
    const timer = setTimeout(() => {
      void (async () => {
        if (!view || view.zoom < MIN_LAYER_ZOOM || (spots.length === 0 && !lighting)) {
          setLayers(EMPTY_LAYERS);
          setLayerError(null);
          askedFor.current = null;
          return;
        }

        // Still inside the cooling-off period after a rate limit.
        if (Date.now() < quietUntil) return;

        /*
         * The visible box, rounded outward onto a grid.
         *
         * This is what stops the map costing one Overpass query per pan. The
         * box went into the query at five decimal places — a metre — so every
         * drag produced a different question, and a service that hands out two
         * slots per IP was asked a new one each time. Snapped, most pans ask
         * the question already answered, and the answer is already here.
         */
        const box = snapBox(view.bbox, gridStep(view.bbox));
        const asking = `${box.south},${box.west},${box.north},${box.east}|${[...spots].sort().join(",")}|${lighting}`;
        if (asking === askedFor.current) return;

        const result = await fetchLayers(box, spots, lighting, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.ok) {
          askedFor.current = asking;
          setLayers(result.data);
          setLayerError(null);
        } else if (result.error !== "cancelled") {
          setLayerError(result.error);
          // Back off rather than asking again on the next twitch of the map.
          if (/rate limit/i.test(result.error)) setQuietUntil(Date.now() + RATE_LIMIT_REST_MS);
        }
      })();
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [view, spots, lighting, quietUntil]);

  const centre = useMemo(() => start ?? end ?? AMSTERDAM, [start, end]);
  const visibleReports = useMemo(
    () => reports.filter((report) => crime.includes(report.category)),
    [reports, crime],
  );
  const exampleCount = useMemo(() => countExamples(reports), [reports]);

  const usePlace = (which: "start" | "end") => (place: Place) => {
    if (which === "start") {
      setStart(place.point);
      setStartText(place.label);
    } else {
      setEnd(place.point);
      setEndText(place.label);
    }
  };

  const swap = () => {
    setStart(end);
    setEnd(start);
    setStartText(endText);
    setEndText(startText);
  };

  /** Opening a tab is a request to see it, so the sheet comes up with it. */
  const openTab = (next: Tab) => {
    setTab(next);
    setSnap((current) => (current === "peek" ? "half" : current));
  };

  const next = start === null ? "A" : end === null ? "B" : null;
  const chosen = routes[selected];
  const chosenAssessment = assessments[selected] ?? null;
  const activeLayers = spots.length + (lighting ? 1 : 0);

  /* The one line that stays on screen however far down the sheet is pushed. */
  const peek = chosenAssessment ? (
    <>
      <span className={`peek-verdict ${VERDICT_CLASS[chosenAssessment.verdict]}`}>
        {VERDICT_LABEL[chosenAssessment.verdict]}
        {chosenAssessment.score !== null && <small>{chosenAssessment.score}/100</small>}
      </span>
      {chosen && (
        <span className="peek-figures">
          {formatDistance(chosen.metres)} · {formatDuration(chosen.seconds)}
        </span>
      )}
    </>
  ) : (
    <span className="peek-hint" aria-live="polite">
      {busy
        ? "Finding the ways round…"
        : routes.length > 0
          ? "Reading the streets…"
          : next
            ? `Tap the map to set ${next}, or search above.`
            : "Set a start and a destination."}
    </span>
  );

  return (
    /* The stop is on the frame, not just the sheet: the map's own buttons and
       the reporting banner have to move out from under the panel with it. */
    <div className="app" data-snap={snap}>
      <main className={reportMode ? "map reporting" : "map"}>
        <MapCanvas
          start={start}
          end={end}
          routes={routes}
          selected={selected}
          segments={segments}
          highlight={worst}
          sheetSnap={snap}
          onSelectRoute={setSelected}
          centre={centre}
          layers={layers}
          reports={visibleReports}
          reportMode={reportMode}
          onReport={dropReport}
          onRemoveReport={remove}
          onPick={pick}
          onMoveStart={setStart}
          onMoveEnd={setEnd}
          onTileError={() => setTilesFailed(true)}
          onView={setView}
          night={night}
        />

        <TripCard
          start={start} end={end}
          startText={startText} endText={endText}
          onStartText={setStartText} onEndText={setEndText}
          onPickStart={usePlace("start")} onPickEnd={usePlace("end")}
          onClearStart={() => { setStart(null); setStartText(""); }}
          onClearEnd={() => { setEnd(null); setEndText(""); }}
          onSwap={swap}
          next={next}
          night={night} onNight={setNight}
        />

        {reportMode && (
          <p className="reporting-banner">
            Tapping the map adds a report — not a route point.
          </p>
        )}
      </main>

      <BottomSheet
        snap={snap}
        onSnap={setSnap}
        peek={peek}
        tabs={
          <nav className="tabs" aria-label="Panel sections">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={entry.id === tab ? "on" : ""}
                aria-pressed={entry.id === tab}
                onClick={() => openTab(entry.id)}
              >
                <span className="tab-glyph" aria-hidden="true">{entry.glyph}</span>
                {entry.label}
                {entry.id === "layers" && activeLayers > 0 ? ` ${activeLayers}` : ""}
              </button>
            ))}
          </nav>
        }
      >
        {error && <p className="error">{error}</p>}
        {factsError && <p className="error">{factsError}</p>}
        {tilesFailed && (
          <p className="error">
            The map tiles could not load, so the background is blank — everything else on this
            page still works, and that is a gap in what could be reached, not an empty map.{" "}
            {tilesForwarded
              ? <>They come through this server, so it is this server that could not fetch
                 them. <a href="/api/osm/status" target="_blank" rel="noreferrer">Check the
                 routes out.</a></>
              : "They are fetched straight from OpenStreetMap by this browser."}
          </p>
        )}

        {/* ── Route ─────────────────────────────────────────────────────── */}
        {tab === "route" && (
          <>
            <div className="group">
              <h2>Getting there</h2>
              <div className="segmented" role="group" aria-label="Travel mode">
                {PROFILES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === profile ? "on" : ""}
                    aria-pressed={option === profile}
                    onClick={() => setProfile(option)}
                  >
                    {PROFILE_LABEL[option]}
                  </button>
                ))}
              </div>
            </div>

            {/* A slider, not a dropdown of twenty-four times. This is the one
                control on the page people actually move, and what it does to
                the verdict is said right beside it. */}
            <div className="group when">
              <h2>Travelling at</h2>
              <div className="when-head">
                <span className="when-time">{String(hour).padStart(2, "0")}:00</span>
                <span className="when-light">{LIGHT_WORD[light]}</span>
                <button type="button" className="ghost" onClick={() => setHour(new Date().getHours())}>
                  Now
                </button>
              </div>
              <input
                type="range"
                min={0} max={23} step={1}
                value={hour}
                onChange={(event) => setHour(Number(event.target.value))}
                aria-label="Hour of travel"
                aria-valuetext={`${String(hour).padStart(2, "0")}:00, ${LIGHT_WORD[light]}`}
              />
              <div className="when-scale" aria-hidden="true">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
              </div>
            </div>

            {routes.length === 0 && !busy && (
              <p className="empty">
                <strong>Set A and B</strong> to compare the ways round.<br />
                Tap the map, or search for an address above.
              </p>
            )}

            <RouteChoices
              routes={routes}
              assessments={assessments}
              comparison={comparison}
              selected={selected}
              onSelect={setSelected}
              done={done}
            />

            {chosen && !busy && (
              <div className="summary">
                <div><span>{formatDistance(chosen.metres)}</span><small>distance</small></div>
                <div><span>{formatDuration(chosen.seconds)}</span><small>{PROFILE_TIME[profile]}</small></div>
              </div>
            )}
          </>
        )}

        {/* ── Safety ────────────────────────────────────────────────────── */}
        {tab === "safety" && (
          <>
            {!busy && facts[selected] ? (
              <SafetyPanel
                facts={facts[selected] ?? null}
                when={when}
                segments={segments}
                worstLine={worstLine}
              />
            ) : (
              <p className="empty">
                {routes.length === 0
                  ? <>The safety read appears once there is a route.<br />Set <strong>A</strong> and <strong>B</strong> first.</>
                  : "Reading what OpenStreetMap says about these streets…"}
              </p>
            )}
            <p className="credit">
              Routing by <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a>,
              search by <a href="https://nominatim.org/" target="_blank" rel="noreferrer">Nominatim</a>,
              map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.
              <strong> Nothing here can tell you a route is safe.</strong>
            </p>
          </>
        )}

        {/* ── Layers ────────────────────────────────────────────────────── */}
        {tab === "layers" && (
          <FilterPanel
            spots={spots} onSpots={setSpots}
            lighting={lighting} onLighting={setLighting}
            crime={crime} onCrime={setCrime}
            reportMode={reportMode} onReportMode={setReportMode}
            reportCategory={reportCategory} onReportCategory={setReportCategory}
            reportCount={visibleReports.length}
            hiddenReports={reports.length - visibleReports.length}
            exampleCount={exampleCount}
            onClearExamples={clearExamples}
            backend={backend}
            reportError={reportError}
            zoomedOut={zoomedOut}
            layerError={layerError}
            truncated={layers.truncated}
          />
        )}
      </BottomSheet>
    </div>
  );
}
