"use client";

/**
 * The page: pick two points, get routes, compare them, and switch layers on.
 *
 * Built for a 360px phone and widened from there. The map is the page; the
 * trip card floats over the top of it and the panel is a sheet you drag up
 * from the bottom. From 900px the sheet becomes a sidebar — see `globals.css`,
 * where the only `min-width` queries in the app live.
 *
 * FOUR TABS, ONE TASK EACH. This is the supervisor's organisation, and the
 * order is the order a person thinks in:
 *
 *   * **Route**   — your options, and the one we suggest. Practical things:
 *                   how you travel, when, and which way round.
 *   * **Safety**  — WHY we suggest it. The reading explained, every factor
 *                   for every route side by side. Explains; changes nothing.
 *   * **Layers**  — make it yours: what counts in the reading, what is on
 *                   the map. Every route re-reads at once.
 *   * **Reports** — your experience and other people's, and the police
 *                   figures. Beside the reading, never inside it.
 *
 * The interviews panel that used to be a fifth tab is at `/research` now: it is
 * the researcher's view of the study, not something a participant consults on
 * the way home, and on the tab bar it was the one tab with no bearing on the
 * walk in front of you.
 *
 * The LEGEND floats on the map with a switch per layer, so lighting, places
 * and reports can be seen together without opening a tab at all.
 *
 * The map is imported with `ssr: false` and that has to happen from a CLIENT
 * component: `next/dynamic` refuses to disable SSR from a server component, and
 * Leaflet cannot be server-rendered at all — it touches `window` while the
 * module is still being evaluated.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import BottomSheet, { type Snap } from "@/components/BottomSheet";
import LayersPanel from "@/components/LayersPanel";
import Legend, { type LayerId } from "@/components/Legend";
import ReportsPanel from "@/components/ReportsPanel";
import RouteChoices, { type Alongside } from "@/components/RouteChoices";
import SafetyPanel from "@/components/SafetyPanel";
import TripCard, { type ScenarioControls } from "@/components/TripCard";
import { useReports } from "@/components/useReports";
import { useRouteFacts } from "@/components/useRouteFacts";
import { aroundHour, placesAlong, reportsAlong } from "@/lib/alongside";
import { compareRoutes } from "@/lib/compare";
import { plannedAt, type Light } from "@/lib/daylight";
import { isForwarded } from "@/lib/endpoints";
import type { Place } from "@/lib/geocode";
import { EMPTY_LAYERS, fetchLayers, gridStep, snapBox, type BBox, type LayerData } from "@/lib/layers";
import { fetchAreas, fetchBoundaries } from "@/lib/nl-areas";
import { fetchNeighbourhoodCrime, type PlacedCrimeSummary } from "@/lib/nl-crime";
import { MAX_WAYPOINTS, googleMapsLink } from "@/lib/handoff";
import { fetchRoutes, PROFILES, type LatLng, type Profile, type Route } from "@/lib/osrm";
import type { RouteFacts, SampleRead } from "@/lib/overpass";
import type { Tone } from "@/lib/palette";
import { countExamples, CRIME_CATEGORIES, newReportId, type Report } from "@/lib/reports";
import {
  destinationById, parseRecording, recordedLeg, scenarioReports,
  SCENARIO_DESTINATIONS, SCENARIO_HOUR, SCENARIO_NOW, SCENARIO_PROFILES, SCENARIO_START,
  type ScenarioRecording,
} from "@/lib/scenario";
import { ALL_FACTORS, allOn, assess, lightingFor, type Factors, type When } from "@/lib/score";
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

/** What the hour you picked actually means, beside the clock reading. */
const LIGHT_WORD: Record<Light, string> = {
  day: "daylight",
  twilight: "dusk",
  night: "after dark",
};

type Tab = "route" | "safety" | "layers" | "reports";

const TABS: { id: Tab; glyph: string; label: string }[] = [
  { id: "route", glyph: "🧭", label: "Route" },
  { id: "safety", glyph: "💡", label: "Safety" },
  { id: "layers", glyph: "◧", label: "Layers" },
  { id: "reports", glyph: "💬", label: "Reports" },
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

/**
 * The hour the page starts on, before the browser has been asked what time it
 * really is. See the note on `hour` below — it exists because this page is
 * prerendered, and a clock read during render is the build machine's clock.
 */
const NOON = 12;

const THEME_KEY = "maddie.theme.v1";

/** `?scenario=utrecht` turns the study scenario on, and a reload keeps it. */
const SCENARIO_PARAM = "scenario";
const SCENARIO_ID = "utrecht";

/** The layers on by default. Police off: slow, and the most easily misread. */
const SHOWN_DEFAULT: Record<LayerId, boolean> = { lighting: true, places: true, reports: true, police: false };

/** A stable empty list, so the live route reader sees no change in the scenario. */
const NO_ROUTES: Route[] = [];

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
  /*
   * The safety read turns almost entirely on whether it is dark, so the hour is
   * something you set rather than something the page assumes.
   *
   * ⚠ It does NOT start from the clock, and that is not fussiness. This page is
   * statically prerendered, so `new Date().getHours()` read during render is
   * evaluated once at BUILD time and baked into the HTML — a build at midnight
   * ships "00:00 · after dark" to everyone, for ever. Every visitor whose hour
   * differs then hydrates against text that does not match, React throws the
   * server HTML away and re-renders the whole page, and the first paint is
   * wrong about the one input the verdict actually turns on.
   *
   * So it starts at a fixed hour and is corrected on mount, when there is a
   * browser to ask. `NOON` rather than midnight because it is the honest
   * placeholder: a page that has not yet worked out what time it is should not
   * be claiming it is dark.
   */
  const [hour, setHour] = useState<number>(NOON);
  /** "Now" for the age of a report — read on mount, for the same reason. */
  const [now, setNow] = useState<number>(SCENARIO_NOW);

  const [liveRoutes, setLiveRoutes] = useState<Route[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  const [tab, setTab] = useState<Tab>("route");
  const [snap, setSnap] = useState<Snap>("peek");
  const [legendOpen, setLegendOpen] = useState(false);

  const [night, setNight] = useState(false);
  /** One state for every layer switch — the legend's and the tabs' alike. */
  const [shown, setShown] = useState<Record<LayerId, boolean>>(SHOWN_DEFAULT);
  const [spots, setSpots] = useState<string[]>(["police", "hospital", "transit", "bar"]);
  /** What counts in the route reading. Every factor on is the reading as it always was. */
  const [factors, setFactors] = useState<Factors>(ALL_FACTORS);
  const [crime, setCrime] = useState<string[]>(() => CRIME_CATEGORIES.map((c) => c.id));
  const [onlyAroundHour, setOnlyAroundHour] = useState(false);
  const [reportMode, setReportMode] = useState(false);
  const [reportCategory, setReportCategory] = useState<string>(CRIME_CATEGORIES[0]?.id ?? "other");
  const [reportNote, setReportNote] = useState("");
  const { reports: storedReports, backend, error: reportError, add, remove, clearExamples } = useReports();

  /* ── the study scenario ─────────────────────────────────────────────────
     See `scenario.ts`. While it is on, the routes, the reads behind them and
     the layers come from a recording, the reports from a fixed generator, and
     nothing a participant does goes to the network or the database. */
  const [scenarioOn, setScenarioOn] = useState(false);
  const [recording, setRecording] = useState<ScenarioRecording | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [sessionReports, setSessionReports] = useState<Report[]>([]);
  const [hiddenInSession, setHiddenInSession] = useState<string[]>([]);

  const [view, setView] = useState<{ bbox: BBox; zoom: number } | null>(null);
  const [liveLayers, setLiveLayers] = useState<LayerData>(EMPTY_LAYERS);
  const [layerError, setLayerError] = useState<string | null>(null);

  /*
   * The police-figures layer. Off by default, and that is deliberate.
   *
   * It is the slower of the two — a round of PDOK lookups and then CBS — and
   * it is the one most easily misread, so it is something you turn on having
   * read what it is rather than something the page asserts on arrival.
   */
  const [policeAreas, setPoliceAreas] = useState<PlacedCrimeSummary[]>([]);
  const [policePeriods, setPolicePeriods] = useState<string[]>([]);
  const [policeError, setPoliceError] = useState<string | null>(null);
  const [policeBusy, setPoliceBusy] = useState(false);

  // So a slow reply for an old pair cannot overwrite a newer one.
  const inFlight = useRef<AbortController | null>(null);
  /**
   * The layer question already answered — snapped box, kinds, lighting.
   *
   * A pan that does not change it asks nothing at all.
   */
  const askedFor = useRef<string | null>(null);
  /** The same idea for the police layer: its own snapped box, asked once. */
  const askedPolice = useRef<string | null>(null);
  /**
   * Do not ask again until this moment.
   *
   * Set when Overpass says it is rate limiting us. Retrying into a limit on
   * every pan is what keeps the limit saturated — and every one of those
   * attempts also spends a slot the route read needs.
   */
  const [quietUntil, setQuietUntil] = useState(0);

  /* ── first paint, in a browser ──────────────────────────────────────── */
  useEffect(() => {
    // In the IIFE like every other setState in this file: the React Compiler
    // lint rejects one reached synchronously from an effect body.
    void (async () => {
      setNow(Date.now());
      // The legend is open by default where there is room beside the route.
      if (window.innerWidth >= 900) setLegendOpen(true);
      const wanted = new URLSearchParams(window.location.search).get(SCENARIO_PARAM) === SCENARIO_ID;
      if (wanted) enterScenario();
      else setHour(new Date().getHours());
    })();
  }, []);

  /* ── theme ──────────────────────────────────────────────────────────────
     Written onto <html> rather than kept in React alone, because Leaflet's own
     controls and the tile filter are styled by CSS that never sees props. */
  useEffect(() => {
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

  /* ── entering and leaving the scenario ──────────────────────────────── */
  function enterScenario() {
    setScenarioOn(true);
    setStart(SCENARIO_START.point);
    setStartText(SCENARIO_START.label);
    setEnd(null);
    setEndText("");
    setDestinationId(null);
    setHour(SCENARIO_HOUR);
    setProfile("walking");
    setSessionReports([]);
    setHiddenInSession([]);
    setReportMode(false);
    setTab("route");
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(SCENARIO_PARAM, SCENARIO_ID);
      window.history.replaceState(null, "", url);
    } catch {
      // The scenario still works; only a reload will not remember it.
    }
  }

  function leaveScenario() {
    setScenarioOn(false);
    setStart(null);
    setStartText("");
    setEnd(null);
    setEndText("");
    setDestinationId(null);
    setReportMode(false);
    setHour(new Date().getHours());
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(SCENARIO_PARAM);
      window.history.replaceState(null, "", url);
    } catch {
      // Nothing to undo.
    }
  }

  function chooseDestination(id: string) {
    const place = destinationById(id);
    if (!place) return;
    setDestinationId(id);
    setEnd(place.point);
    setEndText(place.label);
    setSelected(0);
    setSnap((current) => (current === "peek" ? "half" : current));
  }

  /*
   * The recording is loaded only when the scenario is on, so nobody else pays
   * for a few hundred kilobytes of Utrecht.
   */
  useEffect(() => {
    if (!scenarioOn || recording) return;
    let gone = false;
    void (async () => {
      try {
        const loaded = await import("@/lib/scenario-recording.json");
        if (gone) return;
        const parsed = parseRecording(loaded.default);
        setRecording(parsed);
        setRecordingError(parsed ? null : "The scenario recording is empty. Run `npm run scenario`.");
      } catch {
        if (!gone) setRecordingError("The scenario recording could not be loaded.");
      }
    })();
    return () => { gone = true; };
  }, [scenarioOn, recording]);

  const dropReport = useCallback((point: LatLng) => {
    const note = reportNote.trim().slice(0, 280);
    const report: Report = {
      id: newReportId(Date.now(), Math.random()),
      category: reportCategory,
      point,
      at: new Date().toISOString(),
      source: "community",
      ...(note ? { note } : {}),
    };
    // In the scenario a report stays in this session. It is a participant
    // showing what they would write, and the study's map must look the same
    // for the next participant.
    if (scenarioOn) setSessionReports((current) => [...current, report]);
    else add(report);
    setReportNote("");
    setReportMode(false);
  }, [add, reportCategory, reportNote, scenarioOn]);

  const removeReport = useCallback((id: string) => {
    if (!scenarioOn) {
      remove(id);
      return;
    }
    setSessionReports((current) => current.filter((report) => report.id !== id));
    setHiddenInSession((current) => [...current, id]);
  }, [remove, scenarioOn]);

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

  /* ── routing (live only) ─────────────────────────────────────────────── */
  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    // Every setState lives inside this, including the "no pair yet" reset: the
    // React Compiler lint rejects one reached synchronously from an effect
    // body, because that is a second render before the first has painted.
    void (async () => {
      if (scenarioOn || !start || !end) {
        setLiveRoutes([]);
        setError(null);
        setBusy(false);
        return;
      }
      setBusy(true);
      const result = await fetchRoutes(start, end, profile, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setBusy(false);
      if (result.ok) {
        setLiveRoutes(result.routes.slice(0, MAX_ROUTES));
        setSelected(0);
        setError(null);
        // There is something to read now, so show some of it. Half rather than
        // full: the point of the answer is where on the map it applies.
        setSnap((current) => (current === "peek" ? "half" : current));
      } else {
        setLiveRoutes([]);
        // An abort is us replacing the request, not a failure worth showing.
        setError(result.error === "cancelled" ? null : result.error);
      }
    })();

    return () => controller.abort();
  }, [start, end, profile, scenarioOn]);

  /* ── the routes on offer, and the read on each ───────────────────────── */
  const recorded = useMemo(
    () => (scenarioOn ? recordedLeg(recording, destinationId, profile) : []),
    [scenarioOn, recording, destinationId, profile],
  );
  const live = useRouteFacts(scenarioOn ? NO_ROUTES : liveRoutes);

  const routes: Route[] = scenarioOn ? recorded : liveRoutes;
  const facts: (RouteFacts | null)[] = useMemo(
    () => (scenarioOn ? recorded.map((route) => route.facts) : live.facts),
    [scenarioOn, recorded, live.facts],
  );
  const reads: (SampleRead[] | null)[] = useMemo(
    () => (scenarioOn ? recorded.map((route) => route.reads) : live.reads),
    [scenarioOn, recorded, live.reads],
  );
  const done = scenarioOn ? recorded.length : live.done;
  const factsError = scenarioOn ? null : live.error;

  /*
   * When and where the walk is.
   *
   * ONE point for every candidate route, not each route's own: the routes are
   * being compared against each other, and two of them judged under different
   * skies would differ by something that has nothing to do with the streets.
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

  /*
   * The map's tone: night whenever the theme is dark OR the hour you are
   * planning for is not daylight. This is what makes "night mode" a thing the
   * MAP does rather than the panel — slide the hour to 23:00 and the grey
   * canvas goes black and the lit streets glow, which is the lighting layer
   * explaining itself.
   */
  const tone: Tone = night || light !== "day" ? "night" : "day";

  // The hour and the factors change the verdict but not the counts, so
  // re-judging is free — no second trip to OpenStreetMap.
  const assessments = useMemo(
    () => facts.map((found) => (found ? assess(found, when, factors) : null)),
    [facts, when, factors],
  );

  const comparison = useMemo(
    () => compareRoutes(routes, assessments),
    [routes, assessments],
  );

  /*
   * The selected route, cut into stretches and scored one by one.
   *
   * Same counts, finer grain, same factors: this is what colours the line on
   * the map and names the stretch worth a closer look.
   */
  const segments = useMemo(() => {
    const read = reads[selected];
    return read ? segmentRoute(read, when, factors) : [];
  }, [reads, selected, when, factors]);

  const chosenScore = assessments[selected]?.score ?? null;
  const worst = useMemo(() => worstStretch(segments, chosenScore), [segments, chosenScore]);
  const worstLine = useMemo(() => describeWorst(worst, chosenScore), [worst, chosenScore]);

  /* ── the layers over the visible map (live only) ─────────────────────── */
  const zoomedOut = view !== null && view.zoom < MIN_LAYER_ZOOM;
  const wantKinds = shown.places ? spots : [];

  useEffect(() => {
    const controller = new AbortController();

    // Panning fires this on every settle, and Overpass gives out a couple of
    // slots per IP. Waiting for the map to stand still is the difference
    // between one query and a 429 that also kills the route read.
    const timer = setTimeout(() => {
      void (async () => {
        if (scenarioOn) return;
        if (!view || view.zoom < MIN_LAYER_ZOOM || (wantKinds.length === 0 && !shown.lighting)) {
          setLiveLayers(EMPTY_LAYERS);
          setLayerError(null);
          askedFor.current = null;
          return;
        }

        // Still inside the cooling-off period after a rate limit.
        if (Date.now() < quietUntil) return;

        /*
         * The visible box, rounded outward onto a grid.
         *
         * This is what stops the map costing one Overpass query per pan. Snapped,
         * most pans ask the question already answered, and the answer is already
         * here.
         */
        const box = snapBox(view.bbox, gridStep(view.bbox));
        const asking = `${box.south},${box.west},${box.north},${box.east}|${[...wantKinds].sort().join(",")}|${shown.lighting}`;
        if (asking === askedFor.current) return;

        const result = await fetchLayers(box, wantKinds, shown.lighting, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.ok) {
          askedFor.current = asking;
          setLiveLayers(result.data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `wantKinds` is derived from `shown` and `spots`
  }, [view, spots, shown.places, shown.lighting, quietUntil, scenarioOn]);

  /* What the map draws: the recording in the scenario, the live answer otherwise. */
  const layers = useMemo<LayerData>(() => {
    const source = scenarioOn ? recording?.layers ?? EMPTY_LAYERS : liveLayers;
    return {
      spots: shown.places ? source.spots.filter((spot) => spots.includes(spot.kind)) : [],
      lamps: shown.lighting ? source.lamps : [],
      litWays: shown.lighting ? source.litWays : [],
      truncated: source.truncated,
    };
  }, [scenarioOn, recording, liveLayers, shown.places, shown.lighting, spots]);

  /* ── the police figures over the visible map ─────────────────────────── */
  useEffect(() => {
    const controller = new AbortController();

    /*
     * A longer settle than the OSM layers use.
     *
     * This costs a round of PDOK lookups and then a CBS query, and the answer
     * is a monthly figure — nothing about it rewards being quick off the mark
     * on a pan that has not finished.
     */
    const timer = setTimeout(() => {
      void (async () => {
        if (!shown.police || !view || view.zoom < MIN_LAYER_ZOOM) {
          setPoliceAreas([]);
          setPoliceError(null);
          askedPolice.current = null;
          return;
        }

        // The same snapped box the other layers use, for the same reason: a
        // pan inside one cell asks the question that was already answered.
        const box = snapBox(view.bbox, gridStep(view.bbox));
        const asking = `${box.south},${box.west},${box.north},${box.east}`;
        if (asking === askedPolice.current) return;

        setPoliceBusy(true);
        try {
          const found = await fetchAreas(box, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!found.ok) {
            if (found.error !== "cancelled") setPoliceError(found.error);
            return;
          }
          if (found.areas.length === 0) {
            /*
             * Outside the Netherlands, almost always. Said plainly rather than
             * drawn as an empty layer: a blank map here would read as "no
             * recorded crime", which is the most reassuring possible rendering
             * of a table that simply does not cover this place.
             */
            askedPolice.current = asking;
            setPoliceAreas([]);
            setPolicePeriods([]);
            setPoliceError("No Dutch neighbourhood here — CBS publishes these figures for the Netherlands only.");
            return;
          }

          const figures = await fetchNeighbourhoodCrime(
            found.areas.map((area) => ({ code: area.code, name: area.name })),
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          if (!figures.ok) {
            if (figures.error !== "cancelled") setPoliceError(figures.error);
            return;
          }

          // The centroid PDOK gave for each area, carried onto its figures —
          // CBS has no geometry at all, so this is the only thing that knows
          // where to put the badge.
          const where = new Map(found.areas.map((area) => [area.code, area.point]));

          /*
           * And the outlines, so the figure is drawn over the area it is
           * actually about rather than at a dot in the middle of it. Asked for
           * only the neighbourhoods that came back WITH figures, and allowed to
           * fail — the badge carries the layer on its own.
           */
          const outlines = await fetchBoundaries(
            figures.data.summaries.map((summary) => summary.areaCode),
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          const shapes = new Map(outlines.map((one) => [one.code, one.rings]));

          askedPolice.current = asking;
          setPoliceAreas(figures.data.summaries.map((summary) => ({
            ...summary,
            point: where.get(summary.areaCode) ?? { lat: 0, lng: 0 },
            ...(shapes.get(summary.areaCode) ? { rings: shapes.get(summary.areaCode) } : {}),
          })));
          setPolicePeriods(figures.data.periods);
          setPoliceError(null);
        } finally {
          if (!controller.signal.aborted) setPoliceBusy(false);
        }
      })();
    }, 900);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [shown.police, view]);

  /* ── reports: which exist, which are shown, which are along the route ── */
  const reports = useMemo<Report[]>(() => {
    if (!scenarioOn) return storedReports;
    const prepared = scenarioReports().filter((report) => !hiddenInSession.includes(report.id));
    return [...prepared, ...sessionReports];
  }, [scenarioOn, storedReports, sessionReports, hiddenInSession]);

  const visibleReports = useMemo(() => {
    if (!shown.reports) return [];
    const byKind = reports.filter((report) => crime.includes(report.category));
    return onlyAroundHour ? aroundHour(byKind, hour) : byKind;
  }, [reports, shown.reports, crime, onlyAroundHour, hour]);

  const reportNow = scenarioOn ? SCENARIO_NOW : now;
  const exampleCount = useMemo(() => countExamples(storedReports), [storedReports]);

  /** Beside each route, never in its score — see `alongside.ts`. */
  const alongside = useMemo<Alongside[]>(
    () => routes.map((route) => ({
      reports: reportsAlong(route.path, visibleReports).length,
      places: placesAlong(route.path, layers.spots).length,
    })),
    [routes, visibleReports, layers.spots],
  );
  const chosen = routes[selected];
  const alongChosen = useMemo(
    () => (chosen ? reportsAlong(chosen.path, visibleReports) : []),
    [chosen, visibleReports],
  );

  const centre = useMemo(() => start ?? end ?? AMSTERDAM, [start, end]);

  /*
   * Named `pickPlace`, not `usePlace`: it is a factory that returns a handler,
   * not a hook, and the lint reads a `use` prefix inside a branch as a hook.
   */
  const pickPlace = (which: "start" | "end") => (place: Place) => {
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

  const showLayer = useCallback((layer: LayerId, on: boolean) => {
    setShown((current) => ({ ...current, [layer]: on }));
  }, []);

  const next = scenarioOn ? null : start === null ? "A" : end === null ? "B" : null;

  /**
   * The same walk, handed to Google Maps. This is how you navigate it.
   *
   * Not a link to the destination — that would throw away the whole
   * contribution, because Google would plan the fastest route, which is the one
   * this app exists to disagree with. Our route goes with it as waypoints; see
   * `handoff.ts` for how few of them there can be and what that costs.
   *
   * Not offered in the scenario: a participant is not going anywhere.
   */
  const handoff = useMemo(
    () => (chosen && !scenarioOn ? googleMapsLink(chosen.path, profile) : null),
    [chosen, profile, scenarioOn],
  );
  const chosenAssessment = assessments[selected] ?? null;

  const scenarioControls: ScenarioControls | null = scenarioOn
    ? {
        start: SCENARIO_START,
        destinations: SCENARIO_DESTINATIONS,
        destinationId,
        onDestination: chooseDestination,
        onLeave: leaveScenario,
        recordedAt: recording?.recordedAt ?? "",
      }
    : null;

  const hh = `${String(hour).padStart(2, "0")}:00`;
  const skyNote = night
    ? "Night view is on, so the map is dark. Lit streets glow."
    : light === "day"
      ? `${hh} is daylight, so the map is shown by day. Move the hour past sunset to see it at night.`
      : `${hh} is ${LIGHT_WORD[light]}, so the map is shown dark — lit streets glow, unlit ones do not.`;

  /* The one line that stays on screen however far down the sheet is pushed. */
  const peek = chosenAssessment && chosen ? (
    <>
      <span className={`peek-verdict ${VERDICT_CLASS[chosenAssessment.verdict]}`}>
        {comparison.preferred === selected && <span aria-hidden="true">★</span>}
        {VERDICT_LABEL[chosenAssessment.verdict]}
        {chosenAssessment.score !== null && <small>{chosenAssessment.score}/100</small>}
      </span>
      <span className="peek-figures">
        Route {selected + 1} · {formatDuration(chosen.seconds)} · {formatDistance(chosen.metres)}
      </span>
    </>
  ) : (
    <span className="peek-hint" aria-live="polite">
      {scenarioOn
        ? destinationId ? "Reading the streets…" : "Where are you going from Utrecht Centraal?"
        : busy
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
    <div className="app" data-snap={snap} data-tone={tone}>
      <main className={reportMode ? "map reporting" : "map"}>
        <MapCanvas
          start={start}
          end={end}
          routes={routes}
          selected={selected}
          preferred={comparison.preferred}
          fastest={comparison.fastest}
          segments={segments}
          highlight={worst}
          policeAreas={policeAreas}
          sheetSnap={snap}
          onSelectRoute={setSelected}
          centre={centre}
          layers={layers}
          showLighting={shown.lighting}
          reports={visibleReports}
          reportNow={reportNow}
          reportMode={reportMode}
          onReport={dropReport}
          onRemoveReport={removeReport}
          onPick={scenarioOn ? null : pick}
          onMoveStart={setStart}
          onMoveEnd={setEnd}
          movableEnds={!scenarioOn}
          onTileError={() => setTilesFailed(true)}
          onTilesLoaded={() => setTilesFailed(false)}
          onView={setView}
          tone={tone}
        />

        <TripCard
          start={start} end={end}
          startText={startText} endText={endText}
          onStartText={setStartText} onEndText={setEndText}
          onPickStart={pickPlace("start")} onPickEnd={pickPlace("end")}
          onClearStart={() => { setStart(null); setStartText(""); }}
          onClearEnd={() => { setEnd(null); setEndText(""); }}
          onSwap={swap}
          next={next}
          night={night} onNight={setNight}
          scenario={scenarioControls}
        />

        <Legend
          tone={tone}
          open={legendOpen}
          onOpen={setLegendOpen}
          shown={shown}
          onShow={showLayer}
          skyNote={skyNote}
          onOpenTab={openTab}
        />

        {reportMode && (
          <p className="reporting-banner">
            Tap the map where it happened — this adds a report, not a route point.
          </p>
        )}
      </main>

      <BottomSheet
        snap={snap}
        onSnap={setSnap}
        peek={peek}
        tabs={
          <nav className="tabs" aria-label="Panel sections">
            {TABS.map((entry) => {
              const flag =
                entry.id === "layers" && !allOn(factors) ? "•"
                  : entry.id === "reports" && alongChosen.length > 0 ? ` ${alongChosen.length}`
                    : "";
              return (
                <button
                  key={entry.id}
                  type="button"
                  className={entry.id === tab ? "on" : ""}
                  aria-pressed={entry.id === tab}
                  onClick={() => openTab(entry.id)}
                >
                  <span className="tab-glyph" aria-hidden="true">{entry.glyph}</span>
                  <span>{entry.label}{flag && <span className="tab-flag">{flag}</span>}</span>
                </button>
              );
            })}
          </nav>
        }
      >
        {error && <p className="error">{error}</p>}
        {factsError && <p className="error">{factsError}</p>}
        {recordingError && <p className="error">{recordingError}</p>}
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

        {/* ── Route: your options, and our suggestion ───────────────────── */}
        {tab === "route" && (
          <>
            <div className="group">
              <h2>Getting there</h2>
              <div className="segmented" role="group" aria-label="Travel mode">
                {PROFILES.map((option) => {
                  // The scenario was recorded on foot and by bike; a drive
                  // would have to be asked for live, which is the one thing a
                  // controlled session must not do.
                  const off = scenarioOn && !SCENARIO_PROFILES.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      className={option === profile ? "on" : ""}
                      aria-pressed={option === profile}
                      disabled={off}
                      title={off ? "Not part of the study scenario" : undefined}
                      onClick={() => { setProfile(option); setSelected(0); }}
                    >
                      {PROFILE_LABEL[option]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* A slider, not a dropdown of twenty-four times. This is the one
                control on the page people actually move, and what it does to
                the verdict — and now to the map — is said right beside it. */}
            <div className="group when">
              <h2>Travelling at</h2>
              <div className="when-head">
                <span className="when-time">{hh}</span>
                <span className={`when-light sky-${light}`}>{LIGHT_WORD[light]}</span>
                {!scenarioOn && (
                  <button type="button" className="ghost" onClick={() => setHour(new Date().getHours())}>
                    Now
                  </button>
                )}
              </div>
              <input
                type="range"
                min={0} max={23} step={1}
                value={hour}
                onChange={(event) => setHour(Number(event.target.value))}
                aria-label="Hour of travel"
                aria-valuetext={`${hh}, ${LIGHT_WORD[light]}`}
              />
              <div className="when-scale" aria-hidden="true">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
              </div>
            </div>

            {routes.length === 0 && !busy && !scenarioOn && (
              <div className="empty">
                <p><strong>Set A and B</strong> to compare the ways round.<br />
                  Tap the map, or search for an address above.</p>
                <button type="button" className="ghost" onClick={enterScenario}>
                  Or open the Utrecht study scenario
                </button>
              </div>
            )}
            {scenarioOn && !destinationId && (
              <p className="empty">
                <strong>You are at Utrecht Centraal, at {hh}.</strong><br />
                Choose where you are going in the card above.
              </p>
            )}

            <RouteChoices
              routes={routes}
              assessments={assessments}
              comparison={comparison}
              selected={selected}
              onSelect={setSelected}
              done={done}
              alongside={alongside}
              showReports={shown.reports}
              showPlaces={shown.places}
            />

            {routes.length > 0 && (
              <button type="button" className="link-quiet" onClick={() => openTab("safety")}>
                Why this suggestion? →
              </button>
            )}

            {/*
              * How you actually walk it.
              *
              * There is no in-app navigation view: spoken directions,
              * rerouting, a lock screen and a battery budget are not worth
              * rebuilding. What this app is for is which way round to go — and
              * that part travels, as waypoints.
              */}
            {handoff && !busy && (
              <>
                <a
                  className="hand-off"
                  href={handoff.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <span aria-hidden="true">↗</span> Navigate in Google Maps
                </a>
                <p className="hint">
                  {handoff.waypoints > 0
                    ? <>Google gets <strong>this</strong> route, not its own — pinned to{" "}
                       <strong>{handoff.waypoints} waypoint{handoff.waypoints === 1 ? "" : "s"}</strong>
                       {handoff.waypoints >= MAX_WAYPOINTS
                         ? <>, which is all its links allow</>
                         : <> at the corners where the two would otherwise differ</>}
                       {handoff.driftM > 25
                         ? <>. That holds the shape to within about {handoff.driftM} m, not exactly.</>
                         : <>.</>}</>
                    : <>This route is straight enough that Google will draw the same line unprompted.</>}
                  {" "}What it cannot carry is the reading — the lit stretches and the one worth a closer
                  look stay here, so read those first.
                </p>
              </>
            )}
          </>
        )}

        {/* ── Safety: why we suggest it ─────────────────────────────────── */}
        {tab === "safety" && (
          <>
            {!busy && facts[selected] ? (
              <SafetyPanel
                facts={facts[selected] ?? null}
                when={when}
                segments={segments}
                worstLine={worstLine}
                factors={factors}
                tone={tone}
                routes={routes}
                allFacts={facts}
                assessments={assessments}
                comparison={comparison}
                selected={selected}
                onSelect={setSelected}
                alongside={alongside}
                showReports={shown.reports}
                showPlaces={shown.places}
              />
            ) : (
              <p className="empty">
                {routes.length === 0
                  ? <>The explanation appears once there is a route.<br />Set <strong>A</strong> and <strong>B</strong> first.</>
                  : "Reading what OpenStreetMap says about these streets…"}
              </p>
            )}
            <p className="credit">
              Routing by <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a>,
              search by <a href="https://nominatim.org/" target="_blank" rel="noreferrer">Nominatim</a>,
              map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.
              <strong> A reading of the map, never a guarantee about a street.</strong>
            </p>
          </>
        )}

        {/* ── Layers: make it yours ─────────────────────────────────────── */}
        {tab === "layers" && (
          <LayersPanel
            factors={factors} onFactors={setFactors}
            shown={shown} onShow={showLayer}
            spots={spots} onSpots={setSpots}
            zoomedOut={zoomedOut}
            layerError={scenarioOn ? null : layerError}
            truncated={layers.truncated}
            recorded={scenarioOn}
          />
        )}

        {/* ── Reports: yours and other people's ─────────────────────────── */}
        {tab === "reports" && (
          <ReportsPanel
            shown={shown} onShow={showLayer}
            crime={crime} onCrime={setCrime}
            aroundHour={onlyAroundHour} onAroundHour={setOnlyAroundHour}
            hour={hour}
            along={alongChosen}
            routeLabel={chosen ? `Route ${selected + 1}` : null}
            reportCount={visibleReports.length}
            hiddenReports={shown.reports ? reports.length - visibleReports.length : 0}
            reportMode={reportMode} onReportMode={setReportMode}
            reportCategory={reportCategory} onReportCategory={setReportCategory}
            reportNote={reportNote} onReportNote={setReportNote}
            exampleCount={exampleCount}
            onClearExamples={clearExamples}
            backend={backend}
            reportError={reportError}
            scenario={scenarioOn}
            policeCount={policeAreas.length}
            policePeriods={policePeriods}
            policeError={policeError}
            policeBusy={policeBusy}
          />
        )}
      </BottomSheet>
    </div>
  );
}
