"use client";

/**
 * The page: pick two points, get routes, compare them, and switch layers on.
 *
 * The map is imported with `ssr: false` and that has to happen from a CLIENT
 * component: `next/dynamic` refuses to disable SSR from a server component, and
 * Leaflet cannot be server-rendered at all — it touches `window` while the
 * module is still being evaluated.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FilterPanel from "@/components/FilterPanel";
import PlaceSearch from "@/components/PlaceSearch";
import RouteChoices from "@/components/RouteChoices";
import SafetyPanel from "@/components/SafetyPanel";
import { useRouteFacts } from "@/components/useRouteFacts";
import { compareRoutes } from "@/lib/compare";
import type { Place } from "@/lib/geocode";
import { EMPTY_LAYERS, fetchLayers, type BBox, type LayerData } from "@/lib/layers";
import { fetchRoutes, PROFILES, type LatLng, type Profile, type Route } from "@/lib/osrm";
import {
  addReport, CRIME_CATEGORIES, loadReports, newReportId, removeReport, saveReports, type Report,
} from "@/lib/reports";
import { assess } from "@/lib/score";
import { formatDistance, formatDuration } from "@/lib/format";

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

/**
 * Below this, the visible box is tens of kilometres across and the query for
 * it either times out or returns more than the map can usefully draw.
 */
const MIN_LAYER_ZOOM = 14;

/** Three is what OSRM offers; reading more than that is a slow page. */
const MAX_ROUTES = 3;

const THEME_KEY = "maddie.theme.v1";

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

  const [night, setNight] = useState(false);
  const [spots, setSpots] = useState<string[]>(["police", "hospital", "transit", "bar"]);
  const [lighting, setLighting] = useState(false);
  const [crime, setCrime] = useState<string[]>(() => CRIME_CATEGORIES.map((c) => c.id));
  const [reportMode, setReportMode] = useState(false);
  const [reportCategory, setReportCategory] = useState<string>(CRIME_CATEGORIES[0]?.id ?? "other");
  const [reports, setReports] = useState<Report[]>([]);

  const [view, setView] = useState<{ bbox: BBox; zoom: number } | null>(null);
  const [layers, setLayers] = useState<LayerData>(EMPTY_LAYERS);
  const [layerError, setLayerError] = useState<string | null>(null);

  // So a slow reply for an old pair cannot overwrite a newer one.
  const inFlight = useRef<AbortController | null>(null);

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

  /* ── reports ────────────────────────────────────────────────────────────
     Read once on mount: `localStorage` does not exist while this is being
     server-rendered, and reading it during render would differ between the two
     passes and be discarded by hydration anyway. */
  useEffect(() => {
    void (async () => {
      setReports(loadReports(typeof window === "undefined" ? null : window.localStorage));
    })();
  }, []);

  const record = useCallback((next: Report[]) => {
    setReports(next);
    saveReports(typeof window === "undefined" ? null : window.localStorage, next);
  }, []);

  const dropReport = useCallback((point: LatLng) => {
    const report: Report = {
      id: newReportId(Date.now(), Math.random()),
      category: reportCategory,
      point,
      at: new Date().toISOString(),
    };
    setReports((current) => {
      const next = addReport(current, report);
      saveReports(typeof window === "undefined" ? null : window.localStorage, next);
      return next;
    });
  }, [reportCategory]);

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
      } else {
        setRoutes([]);
        // An abort is us replacing the request, not a failure worth showing.
        setError(result.error === "cancelled" ? null : result.error);
      }
    })();

    return () => controller.abort();
  }, [start, end, profile]);

  /* ── the read on each route ──────────────────────────────────────────── */
  const { facts, done, error: factsError } = useRouteFacts(routes);

  // The hour changes the verdict but not the counts, so re-judging is free —
  // no second trip to OpenStreetMap.
  const assessments = useMemo(
    () => facts.map((found) => (found ? assess(found, hour) : null)),
    [facts, hour],
  );

  const comparison = useMemo(
    () => compareRoutes(routes, assessments),
    [routes, assessments],
  );

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
          return;
        }
        const result = await fetchLayers(view.bbox, spots, lighting, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.ok) {
          setLayers(result.data);
          setLayerError(null);
        } else if (result.error !== "cancelled") {
          setLayerError(result.error);
        }
      })();
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [view, spots, lighting]);

  const centre = useMemo(() => start ?? end ?? AMSTERDAM, [start, end]);
  const visibleReports = useMemo(
    () => reports.filter((report) => crime.includes(report.category)),
    [reports, crime],
  );

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

  const next = start === null ? "A" : end === null ? "B" : null;
  const chosen = routes[selected];

  return (
    <div className="layout">
      <aside className="panel">
        <header>
          <div className="title-row">
            <h1>Maddie</h1>
            <button
              type="button"
              className="ghost theme"
              onClick={() => setNight((on) => !on)}
              aria-pressed={night}
              title={night ? "Switch to light mode" : "Switch to night mode"}
            >
              {night ? "☀ Light" : "☾ Night"}
            </button>
          </div>
          <p>
            Set <strong>A</strong> and <strong>B</strong>, then compare the ways round.
            Click the map or search for an address; drag either pin to move it.
          </p>
        </header>

        <PlaceSearch
          label="Start" badge="A" accent="#22c55e"
          value={start} text={startText} onText={setStartText}
          onPick={usePlace("start")}
          onClear={() => { setStart(null); setStartText(""); }}
        />

        <PlaceSearch
          label="Destination" badge="B" accent="#7c5cff"
          value={end} text={endText} onText={setEndText}
          onPick={usePlace("end")}
          onClear={() => { setEnd(null); setEndText(""); }}
        />

        <div className="row">
          <div className="profiles" role="group" aria-label="Travel mode">
            {PROFILES.map((option) => (
              <button
                key={option}
                type="button"
                className={option === profile ? "on" : ""}
                onClick={() => setProfile(option)}
              >
                {PROFILE_LABEL[option]}
              </button>
            ))}
          </div>
          <button type="button" className="ghost" onClick={swap} disabled={!start && !end}>
            ⇅ Swap
          </button>
        </div>

        <div className="row">
          <label className="when">
            Travelling at
            <select value={hour} onChange={(event) => setHour(Number(event.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </label>
        </div>

        {reportMode && (
          <p className="hint report-on">
            Clicking the map adds a report, not a route point. Untick it in the Crime filter
            to go back to setting A and B.
          </p>
        )}
        {next && !reportMode && (
          <p className="hint">Click the map to place <strong>{next}</strong>.</p>
        )}

        {busy && <p className="hint">Finding routes…</p>}
        {error && <p className="error">{error}</p>}
        {factsError && <p className="error">{factsError}</p>}

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

        {!busy && <SafetyPanel facts={facts[selected] ?? null} hour={hour} />}

        <FilterPanel
          spots={spots} onSpots={setSpots}
          lighting={lighting} onLighting={setLighting}
          crime={crime} onCrime={setCrime}
          reportMode={reportMode} onReportMode={setReportMode}
          reportCategory={reportCategory} onReportCategory={setReportCategory}
          reportCount={visibleReports.length}
          hiddenReports={reports.length - visibleReports.length}
          zoomedOut={zoomedOut}
          layerError={layerError}
          truncated={layers.truncated}
        />

        {tilesFailed && (
          <p className="error">
            The map tiles could not be loaded, so the background is blank. Everything else still
            works — that is a gap in what this browser can reach, not an empty map.
          </p>
        )}

        <footer>
          Routing by <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a>,
          search by <a href="https://nominatim.org/" target="_blank" rel="noreferrer">Nominatim</a>,
          map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.
          Nothing here can tell you a route is safe.
        </footer>
      </aside>

      <main className={reportMode ? "map reporting" : "map"}>
        <MapCanvas
          start={start}
          end={end}
          routes={routes}
          selected={selected}
          onSelectRoute={setSelected}
          centre={centre}
          layers={layers}
          reports={visibleReports}
          reportMode={reportMode}
          onReport={dropReport}
          onRemoveReport={(id) => record(removeReport(reports, id))}
          onPick={pick}
          onMoveStart={setStart}
          onMoveEnd={setEnd}
          onTileError={() => setTilesFailed(true)}
          onView={setView}
          night={night}
        />
      </main>
    </div>
  );
}
