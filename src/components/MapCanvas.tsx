"use client";

/**
 * The Leaflet map.
 *
 * Loaded only in the browser — see RoutePlanner, which imports this with
 * `ssr: false`. Leaflet reaches for `window` at module scope, so rendering it
 * on the server fails at import time rather than at paint time, which makes the
 * error look unrelated to the map.
 *
 * WHAT IS DRAWN, AND HOW — `docs/Maddie-Design-System.md` is the spec, and
 * `src/lib/palette.ts` holds every colour. The short version, bottom to top:
 *
 *   1. A GREY basemap — OpenStreetMap's own tiles, desaturated in CSS, and
 *      near-black whenever the map is showing night (the theme is dark, or the
 *      hour you are planning for is after dark). A canvas, not a map full of
 *      colours of its own: every colour on top of it has to mean something.
 *   2. Police figures — HATCHED over the whole neighbourhood. Texture, not hue.
 *   3. Lighting — thin yellow lines along lit streets, small yellow dots for
 *      lamps.
 *   4. The routes you did not pick — your trip's ink, faded, each labelled.
 *   5. The chosen route — a GLOW of light around the stretches that are lit,
 *      then a casing, then the line itself coloured stretch by stretch by how
 *      the evidence reads. Grey and dashed where nothing is known, or while it
 *      is still being read.
 *   6. Places to go (pink hearts), reports (blue speech bubbles, fading with
 *      age), the police badges, and A and B on top of everything.
 *
 * Several factors are visible AT ONCE because each one has its own channel —
 * line colour, glow, texture, shape — rather than each one taking a turn at
 * the same colour in a different tab.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, Tooltip,
  useMap, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { formatDuration } from "@/lib/format";
import type { LatLng, Route } from "@/lib/osrm";
import { alwaysOpen, type BBox, type LayerData } from "@/lib/layers";
import { endpoint } from "@/lib/endpoints";
import { AGE_OPACITY, CRIME_CATEGORIES, reportAge, type Report } from "@/lib/reports";
import { MARK_EXAMPLE_DATA } from "@/lib/demo-mode";
import {
  CRIME_BAND_LABEL, crimeBand, topCategories, type CrimeBand, type PlacedCrimeSummary,
} from "@/lib/nl-crime";
import {
  ALTERNATIVE, ALTERNATIVE_OPACITY, END, LIGHT, PLACE, POLICE, REPORT, ROUTE, START,
  UNKNOWN_DASH, pick, type Tone,
} from "@/lib/palette";
import type { Segment } from "@/lib/segments";
import { verdictColour } from "@/lib/verdict";

/**
 * Where the tiles come from — this server by default, which is the only answer
 * that works on both machines the domain resolves to. See `endpoints.ts`.
 */
const TILE_URL = endpoint("tile");

/** From this zoom the hearts show what kind of place they are. */
export const CLOSE_ZOOM = 17;


/**
 * A — a hollow ring. It marks where you are, which you already know, so it is
 * the quietest thing on the map. Inline SVG rather than Leaflet's PNG markers,
 * which every bundler loses the path to.
 */
function startPin(tone: Tone): L.DivIcon {
  const ink = pick(START, tone);
  const fill = tone === "night" ? "#0b0d12" : "#ffffff";
  return L.divIcon({
    className: "",
    html: `
      <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg" aria-label="Start, A">
        <circle cx="14" cy="14" r="11" fill="${fill}" stroke="${ink}" stroke-width="3"/>
        <text x="14" y="18.5" text-anchor="middle" font-size="12" font-weight="700"
              font-family="system-ui, sans-serif" fill="${ink}">A</text>
      </svg>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

/** B — a solid pin, the trip's own ink. The one end that needs finding. */
function endPin(tone: Tone): L.DivIcon {
  const ink = pick(END, tone);
  const letter = tone === "night" ? "#0b0d12" : "#ffffff";
  return L.divIcon({
    className: "",
    html: `
      <svg width="32" height="44" viewBox="0 0 32 44" xmlns="http://www.w3.org/2000/svg" aria-label="Destination, B">
        <path d="M16 43C16 43 30 27 30 16A14 14 0 1 0 2 16c0 11 14 27 14 27z"
              fill="${ink}" stroke="${letter}" stroke-width="2"/>
        <text x="16" y="21" text-anchor="middle" font-size="14" font-weight="800"
              font-family="system-ui, sans-serif" fill="${letter}">B</text>
      </svg>`,
    iconSize: [32, 44],
    iconAnchor: [16, 43],    // the tip of the pin, not its middle
  });
}

/**
 * A place to go: one pink heart for every kind of place.
 *
 * The kind's glyph is IN the marker but hidden until it is asked for — on
 * hover, or from `CLOSE_ZOOM` in. The supervisor's suggestion, and the right
 * default: twelve different icons at once is impossible to read, and "there
 * is somewhere to go here" is the useful first answer.
 */
function heart(glyph: string, tone: Tone): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <div class="spot-pin">
        <svg width="24" height="22" viewBox="0 0 26 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 22.5S1.5 15.4 1.5 8.3A6.3 6.3 0 0 1 13 4.6 6.3 6.3 0 0 1 24.5 8.3c0 7.1-11.5 14.2-11.5 14.2z"
                fill="${pick(PLACE, tone)}" stroke="${tone === "night" ? "#0b0d12" : "#ffffff"}" stroke-width="1.6"/>
        </svg>
        <span class="spot-glyph">${glyph}</span>
      </div>`,
    iconSize: [24, 22],
    iconAnchor: [12, 20],
  });
}

/**
 * Leaflet compares icons by identity, so building a new one each render makes
 * it tear down and rebuild every marker on the map on every keystroke. Every
 * icon below is cached at module scope, keyed by everything that changes it.
 */
const ICONS = new Map<string, L.DivIcon>();

function cached(key: string, make: () => L.DivIcon): L.DivIcon {
  const existing = ICONS.get(key);
  if (existing) return existing;
  const made = make();
  ICONS.set(key, made);
  return made;
}

/**
 * A report: a speech bubble, because each one is somebody telling you
 * something. Blue — calm, not an alarm — and faded by age.
 *
 * The example variant (only when `MARK_EXAMPLE_DATA` is on) is hollow and
 * dashed, which reads as "outline, not filled in" rather than as another
 * category.
 */
function bubble(tone: Tone, age: keyof typeof AGE_OPACITY, example: boolean): L.DivIcon {
  const blue = pick(REPORT, tone);
  const edge = tone === "night" ? "#0b0d12" : "#ffffff";
  const body = "M3 4.5A3.5 3.5 0 0 1 6.5 1h11A3.5 3.5 0 0 1 21 4.5v8A3.5 3.5 0 0 1 17.5 16H11l-4.5 4.5V16h0A3.5 3.5 0 0 1 3 12.5z";
  return L.divIcon({
    className: "",
    html: example
      ? `<svg width="22" height="22" viewBox="0 0 24 22" xmlns="http://www.w3.org/2000/svg">
           <path d="${body}" fill="none" stroke="${blue}" stroke-width="2" stroke-dasharray="3 2.4"/>
         </svg>`
      : `<svg width="22" height="22" viewBox="0 0 24 22" xmlns="http://www.w3.org/2000/svg"
              style="opacity:${AGE_OPACITY[age]}">
           <path d="${body}" fill="${blue}" stroke="${edge}" stroke-width="1.5"/>
           <circle cx="8" cy="8.6" r="1.4" fill="${edge}"/><circle cx="12" cy="8.6" r="1.4" fill="${edge}"/>
           <circle cx="16" cy="8.6" r="1.4" fill="${edge}"/>
         </svg>`,
    iconSize: [22, 22],
    iconAnchor: [7, 21],
  });
}

/**
 * The police-figures badge: an oblong carrying a NUMBER, at the
 * neighbourhood's centroid. A label for the hatched area, never a point where
 * anything happened — which is why it is not a dot and not blue.
 */
function badge(band: CrimeBand, text: string, tone: Tone): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <div class="cbs-badge cbs-${band} tone-${tone}">
        <span class="cbs-badge-n">${text}</span>
      </div>`,
    iconSize: [44, 24],
    iconAnchor: [22, 12],
  });
}

/** Hatch spacing per band, in px: denser is more recorded offences. */
const HATCH_GAP: Record<CrimeBand, number> = { low: 11, medium: 8, high: 5.5, highest: 3.8 };
const BANDS: CrimeBand[] = ["low", "medium", "high", "highest"];

/**
 * The hatch patterns, as an SVG the polygons can point at with `url(#…)`.
 *
 * Leaflet writes `fillColor` straight into the path's `fill` attribute, and an
 * SVG `url()` reference resolves against the whole document — so the police
 * polygons, drawn with an SVG renderer, can be filled with a pattern defined
 * here. The rest of the map stays on canvas.
 */
function HatchDefs({ tone }: { tone: Tone }) {
  const ink = pick(POLICE, tone);
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {BANDS.map((band) => (
          <pattern
            key={band}
            id={`hatch-${band}`}
            width={HATCH_GAP[band]}
            height={HATCH_GAP[band]}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2={HATCH_GAP[band]} stroke={ink} strokeWidth="1.3" strokeOpacity="0.75" />
          </pattern>
        ))}
      </defs>
    </svg>
  );
}

export interface MapCanvasProps {
  start: LatLng | null;
  end: LatLng | null;
  /** Every route on offer. The selected one is drawn on top, in colour. */
  routes: Route[];
  selected: number;
  /** The route the comparison recommends, or null when none stands out. */
  preferred: number | null;
  /** The quickest route. Labelled, never coloured. */
  fastest: number | null;
  /**
   * The selected route cut into stretches, each with its own verdict.
   *
   * Empty while the route is still being read, and then a grey DASHED line is
   * drawn instead — "not known yet", which is true, in the same grey and dash
   * as a stretch the map says nothing about. One statement, one look.
   */
  segments: Segment[];
  /** The stretch worth a closer look, if there is one. Drawn with a halo. */
  highlight: Segment | null;
  /**
   * How far open the panel is.
   *
   * Only used to re-fit the route when it changes: the sheet covers the bottom
   * of the map, so how much of the map there is depends on it.
   */
  sheetSnap: string;
  onSelectRoute: (index: number) => void;
  centre: LatLng;
  layers: LayerData;
  /** Whether the lighting layer and the glow around the route are drawn. */
  showLighting: boolean;
  reports: Report[];
  /** What "now" is for the age of a report. The scenario fixes it. */
  reportNow: number;
  /**
   * Police-recorded figures for the neighbourhoods on screen.
   *
   * A separate prop from `reports` and never merged with them: one is a
   * per-neighbourhood monthly count from CBS, the other is one person saying
   * something happened at one place. See `nl-crime.ts`.
   */
  policeAreas: PlacedCrimeSummary[];
  /** Dropping a report instead of a route point. */
  reportMode: boolean;
  onReport: (point: LatLng) => void;
  onRemoveReport: (id: string) => void;
  /** A map click sets whichever point is next. Null when the ends are fixed. */
  onPick: ((point: LatLng) => void) | null;
  onMoveStart: (point: LatLng) => void;
  onMoveEnd: (point: LatLng) => void;
  /** False in the scenario, where every participant starts from the same place. */
  movableEnds: boolean;
  onTileError: () => void;
  /** Fires after panning or zooming settles, with the new visible box. */
  onView: (view: { bbox: BBox; zoom: number }) => void;
  /** Day or night — the basemap and every colour on it follow this. */
  tone: Tone;
}

/** Turns a click anywhere on the map into a point. */
function ClickToPick({ onPick }: { onPick: ((point: LatLng) => void) | null }) {
  useMapEvents({
    click(event) {
      onPick?.({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/**
 * Report the visible box, once things have stopped moving — and mark the
 * container when it is zoomed in close enough for the hearts to say what they
 * are.
 *
 * Overpass hands out a couple of query slots per IP, so a query per frame of a
 * pan is the fastest way to a 429 that then blocks every other layer too.
 */
function WatchView({ onView }: { onView: MapCanvasProps["onView"] }) {
  const map = useMap();

  useEffect(() => {
    function report() {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      map.getContainer().classList.toggle("zoom-close", zoom >= CLOSE_ZOOM);
      onView({
        bbox: {
          south: bounds.getSouth(), west: bounds.getWest(),
          north: bounds.getNorth(), east: bounds.getEast(),
        },
        zoom,
      });
    }
    report();
    map.on("moveend", report);
    return () => { map.off("moveend", report); };
  }, [map, onView]);

  return null;
}

/**
 * Keep the whole route in view — in the part of the map you can actually see.
 *
 * The trip card floats over the top of the map and the sheet covers the bottom,
 * so fitting into the whole viewport puts both ends of the route underneath
 * furniture. The space left over is measured from the two elements themselves
 * rather than recomputed from their snap points: the DOM is the one place that
 * already knows, and a second copy of those numbers is a second thing to keep
 * in step when either changes size.
 *
 * Keyed on the route's own shape, not on the array: re-fitting whenever the
 * layer data came back would yank the map away from wherever it was panned to.
 * `token` is bumped by the ⤢ button, and `sheet` changes when the panel is
 * dragged — both are re-fits that a key alone would not notice.
 *
 * Fitted to ALL the routes, not just the selected one: the comparison is the
 * task, and an alternative that runs off the edge of the screen cannot be
 * compared with anything.
 */
function FitToRoute({ routes, token, sheet }: { routes: Route[]; token: number; sheet: string }) {
  const map = useMap();
  const key = routes.map((route) => `${route.metres}:${route.path.length}`).join("|");

  useEffect(() => {
    const points = routes.flatMap((route) => route.path);
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));

    /* The sheet takes 220ms to settle, and measuring it mid-slide fits the
       route into a box that no longer exists a moment later. */
    const timer = setTimeout(() => {
      const height = (selector: string) =>
        Math.round(document.querySelector(selector)?.getBoundingClientRect().height ?? 0);

      // From 900px the panel is a sidebar beside the map rather than over it,
      // so nothing is covering anything and the margins are just margins.
      const narrow = window.innerWidth < 900;
      const top = narrow ? height(".trip") : 0;
      const bottom = narrow ? height(".sheet") : 0;

      /* 52px of slack on top of whatever is covering the map: a pin is
         anchored at its tip and stands 43px above it, so fitting the LINE to
         the edge cuts the head off the pin at either end. */
      map.fitBounds(bounds, {
        paddingTopLeft: [26, top + 52],
        paddingBottomRight: [26, bottom + 52],
      });
    }, 260);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for the routes' identity
  }, [map, key, token, sheet]);

  return null;
}

/**
 * Tell Leaflet when its container changed shape.
 *
 * Leaflet caches the container's size and only re-measures on a window resize.
 * The sheet being dragged, a desktop window resize or an on-screen keyboard all
 * change the container without one, and the result is tiles that stop dead
 * partway across — which looks exactly like a half-loaded map.
 */
function KeepSized() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    // `animate: false` — a size correction is not a movement to watch.
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

/** The share of a stretch OpenStreetMap records as lit — what the glow shows. */
function litShare(segment: Segment): number {
  return segment.facts.samples > 0 ? segment.facts.litSamples / segment.facts.samples : 0;
}

export default function MapCanvas({
  start, end, routes, selected, preferred, fastest, segments, highlight, sheetSnap, onSelectRoute,
  centre, layers, showLighting, reports, reportNow, policeAreas, reportMode, onReport, onRemoveReport,
  onPick, onMoveStart, onMoveEnd, movableEnds, onTileError, onView, tone,
}: MapCanvasProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const refit = useCallback(() => setFitToken((n) => n + 1), []);

  // The police hatch needs real SVG elements to point a pattern at; the rest
  // of the map stays on canvas, where hundreds of lamps are one DOM node.
  const svgRenderer = useMemo(() => L.svg({ padding: 0.5 }), []);

  // One report is enough: a blocked tile host fires this for every tile in view.
  const [reported, setReported] = useState(false);

  const categoryLabel = useMemo(
    () => new Map(CRIME_CATEGORIES.map((c) => [c.id, c.label])),
    [],
  );

  const ink = pick(ALTERNATIVE, tone);
  const light = pick(LIGHT, tone);
  // The casing is the BASEMAP's colour, not a fixed dark: it is what separates
  // the line from the streets under it, so it has to be the opposite of the line.
  const casing = tone === "night" ? "#05070b" : "#ffffff";
  const chosen = routes[selected];

  /** "Preferred · 21 min" — the words on the line itself, so nothing has to be looked up. */
  const routeLabel = (index: number, route: Route) => {
    const parts: string[] = [];
    if (preferred === index) parts.push("★ Preferred");
    else parts.push(`Route ${index + 1}`);
    if (fastest === index && routes.length > 1) parts.push("fastest");
    parts.push(formatDuration(route.seconds));
    return parts.join(" · ");
  };

  return (
    <>
    <HatchDefs tone={tone} />
    <MapContainer
      center={[centre.lat, centre.lng]}
      zoom={14}
      scrollWheelZoom
      // Leaflet's own zoom buttons are top-left, which on a phone is the corner
      // the hand holding it cannot reach — and it is under the trip card. They
      // are replaced by the cluster below, bottom-right, above the sheet.
      zoomControl={false}
      ref={setMap}
      // Hundreds of lamps and lit streets as SVG elements is hundreds of DOM
      // nodes; on canvas it is one.
      preferCanvas
      className={`tone-${tone}`}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        // OpenStreetMap's own tiles, made a grey canvas in CSS (`.tiles-day`,
        // `.tiles-night`). Not a second tile host: a second provider is a
        // second thing that can be unreachable, and a map whose background
        // silently fails to load is the worst way to render a page about
        // walking somewhere after dark.
        className={`tiles-${tone}`}
        url={TILE_URL}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
        eventHandlers={{
          tileerror: () => {
            if (reported) return;
            setReported(true);
            onTileError();
          },
        }}
      />

      <ClickToPick onPick={reportMode ? onReport : onPick} />
      <KeepSized />
      <WatchView onView={onView} />
      <FitToRoute routes={routes} token={fitToken} sheet={sheetSnap} />

      {/* ── police figures: hatched areas, under everything ────────────────
          The least precise thing on the map — one figure for a whole shape —
          so it sits under the route and never obscures it. `interactive:
          false`: the badge is what you tap. A solid edge, not a dashed one,
          because the figure applies to everything inside it equally. */}
      {policeAreas.map((area) => {
        if (!area.rings || area.rings.length === 0) return null;
        const band = crimeBand(area.severityPerMonth);
        return (
          <Polygon
            key={`shape-${area.areaCode}-${tone}`}
            positions={area.rings.map((one) => one.map((p) => [p.lat, p.lng] as [number, number]))}
            renderer={svgRenderer}
            pathOptions={{
              color: pick(POLICE, tone),
              weight: 1.4,
              opacity: 0.6,
              fillColor: `url(#hatch-${band})`,
              fillOpacity: 1,
              interactive: false,
            }}
          />
        );
      })}

      {/* ── lighting ─────────────────────────────────────────────────────── */}
      {showLighting && layers.litWays.map((way) => (
        <Polyline
          key={way.id}
          positions={way.path.map((p) => [p.lat, p.lng])}
          pathOptions={{ color: light, weight: tone === "night" ? 3 : 2.5, opacity: tone === "night" ? 0.7 : 0.6, interactive: false }}
        />
      ))}
      {showLighting && layers.lamps.map((lamp) => (
        <CircleMarker
          key={lamp.id}
          center={[lamp.point.lat, lamp.point.lng]}
          radius={tone === "night" ? 2.4 : 2}
          pathOptions={{ color: light, fillColor: light, fillOpacity: 0.95, weight: 0, interactive: false }}
        />
      ))}

      {/* ── the routes you did not pick ───────────────────────────────────── */}
      {routes.map((route, index) => {
        if (index === selected) return null;
        return (
          <Polyline
            key={`alt-${index}-${tone}`}
            positions={route.path.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: ink, weight: 5, opacity: ALTERNATIVE_OPACITY }}
            eventHandlers={{ click: () => onSelectRoute(index) }}
          >
            <Tooltip permanent direction="center" className={`route-tag tone-${tone}${preferred === index ? " is-preferred" : ""}`}>
              {routeLabel(index, route)}
            </Tooltip>
          </Polyline>
        );
      })}

      {/* ── the chosen route ─────────────────────────────────────────────── */}
      {chosen && (
        <>
          {/* LIGHT, as light: a soft glow around each stretch, as strong as
              the share of it OpenStreetMap records as lit. Two widths fake a
              falloff. Under the casing, so the route colour is never tinted —
              the line says how the evidence reads, the glow says whether it
              is lit, and both are readable at once. */}
          {showLighting && segments.map((segment) => {
            const share = litShare(segment);
            if (share <= 0.05) return null;
            const path = segment.path.map((p) => [p.lat, p.lng] as [number, number]);
            return (
              <Polyline
                key={`glow-${segment.fromM}-${tone}`}
                positions={path}
                pathOptions={{ color: light, weight: 24, opacity: 0.22 * share, lineCap: "round", interactive: false }}
              />
            );
          })}
          {showLighting && segments.map((segment) => {
            const share = litShare(segment);
            if (share <= 0.05) return null;
            return (
              <Polyline
                key={`glow2-${segment.fromM}-${tone}`}
                positions={segment.path.map((p) => [p.lat, p.lng])}
                pathOptions={{ color: light, weight: 15, opacity: 0.45 * share, lineCap: "round", interactive: false }}
              />
            );
          })}

          {/* The casing — the basemap's own colour, so the line stands off any street. */}
          <Polyline
            positions={chosen.path.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: casing, weight: 10, opacity: 0.9, interactive: false }}
          />

          {/* The stretch worth a closer look, widened so it can be found by
              eye. Under the coloured line, not over it: a halo that hid the
              verdict colour would replace the answer with a pointer to it. */}
          {highlight && (
            <Polyline
              positions={highlight.path.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: verdictColour(highlight.verdict, tone), weight: 18, opacity: 0.3, interactive: false }}
            />
          )}

          {segments.length > 0 ? (
            segments.map((segment) => (
              <Polyline
                key={`seg-${segment.fromM}-${tone}`}
                positions={segment.path.map((p) => [p.lat, p.lng])}
                pathOptions={{
                  color: verdictColour(segment.verdict, tone),
                  weight: preferred === selected ? 7 : 6,
                  // Grey AND dashed where the map says nothing: "not known",
                  // never a colour that could be read as a verdict.
                  dashArray: segment.verdict === "unknown" ? UNKNOWN_DASH : undefined,
                  lineCap: segment.verdict === "unknown" ? "butt" : "round",
                }}
              />
            ))
          ) : (
            /* Still being read: the same grey and dash as "not known". */
            <Polyline
              positions={chosen.path.map((p) => [p.lat, p.lng])}
              pathOptions={{ color: pick(ROUTE.unknown, tone), weight: 6, dashArray: UNKNOWN_DASH, lineCap: "butt" }}
            />
          )}

          {/* The label rides on its own invisible line, so it sits in the
              middle of the route without any stretch owning it. */}
          <Polyline
            positions={chosen.path.map((p) => [p.lat, p.lng])}
            pathOptions={{ opacity: 0, weight: 1, interactive: false }}
          >
            <Tooltip permanent direction="center" className={`route-tag is-selected tone-${tone}${preferred === selected ? " is-preferred" : ""}`}>
              {routeLabel(selected, chosen)}
            </Tooltip>
          </Polyline>
        </>
      )}

      {/* ── places to go ─────────────────────────────────────────────────── */}
      {layers.spots.map((spot) => (
        <Marker
          key={spot.id}
          position={[spot.point.lat, spot.point.lng]}
          icon={cached(`heart|${spot.icon}|${tone}`, () => heart(spot.icon, tone))}
        >
          <Popup>
            <span className="pop-kind kind-place">Place to go · {spot.label}</span>
            <br />
            <strong>{spot.name ?? spot.label}</strong>
            {spot.openingHours && (
              <>
                <br />
                {alwaysOpen(spot.openingHours)
                  ? "Open 24/7"
                  /* Shown as OSM wrote it. This app does not work out whether
                     it is open right now — see `alwaysOpen`. */
                  : <>Hours as mapped: {spot.openingHours}</>}
              </>
            )}
          </Popup>
        </Marker>
      ))}

      {/* ── police figures: the badge on each hatched area ───────────────── */}
      {policeAreas.map((area) => {
        const band = crimeBand(area.severityPerMonth);
        const perMonth = Math.round(area.offencesPerMonth);
        return (
          <Marker
            key={area.areaCode}
            position={[area.point.lat, area.point.lng]}
            icon={cached(`cbs|${band}|${perMonth}|${tone}`, () => badge(band, String(perMonth), tone))}
          >
            {/*
              `maxHeight` rather than a CSS cap, because Leaflet's own auto-pan
              reads this number: it scrolls the content AND shifts the map so
              the popup fits, which CSS alone cannot do.
            */}
            <Popup maxHeight={260}>
              <span className="pop-kind kind-police">Police figures · whole neighbourhood</span>
              <br />
              <strong>{area.areaName}</strong>
              <br />
              {perMonth} recorded offences a month on average
              <br />
              <small>
                {CRIME_BAND_LABEL[band]} · {area.totalCount} over{" "}
                {area.monthsObserved} month{area.monthsObserved === 1 ? "" : "s"}
              </small>
              {topCategories(area).length > 0 && (
                <>
                  <br />
                  {topCategories(area).map((entry) => (
                    <span key={entry.category} className="cbs-row">
                      {entry.label}: {entry.count}
                      <br />
                    </span>
                  ))}
                </>
              )}
              {area.suppressedCells > 0 && (
                <>
                  <br />
                  <small>
                    {area.suppressedCells} figure{area.suppressedCells === 1 ? " was" : "s were"}{" "}
                    withheld by CBS — small numbers, not zero.
                  </small>
                </>
              )}
              <br />
              <small>
                CBS table {area.table}, {area.areaCode}. A count for the whole
                {area.rings ? " hatched area" : " neighbourhood"}, not a place where anything
                happened, and it does not affect the route comparison.
                {!area.rings && " The outline for this neighbourhood could not be loaded, so only this marker is shown."}
              </small>
            </Popup>
          </Marker>
        );
      })}

      {/* ── reports ──────────────────────────────────────────────────────── */}
      {reports.map((report) => {
        // Gated on `MARK_EXAMPLE_DATA`, which is off: seeded reports draw like
        // any other, so the map can be judged as it will look. The `source`
        // field is untouched in the database — see `demo-mode.ts`.
        const invented = report.source === "example" && MARK_EXAMPLE_DATA;
        const age = reportAge(report.at, reportNow);
        return (
          <Marker
            key={report.id}
            position={[report.point.lat, report.point.lng]}
            icon={cached(`bubble|${tone}|${age}|${invented}`, () => bubble(tone, age, invented))}
          >
            <Popup>
              {/* First line, before the category: whatever else the reader
                  takes from this popup, they take that this did not happen. */}
              {invented && <><span className="example-tag">EXAMPLE DATA — NOT A REAL REPORT</span><br /></>}
              <span className="pop-kind kind-report">Report · {categoryLabel.get(report.category) ?? report.category}</span>
              <br />
              {new Date(report.at).toLocaleString()}
              {report.area && <><br />{report.area}</>}
              {report.note && <><br /><span className="pop-note">{report.note}</span></>}
              <br />
              <small>Entered by a person. Shown beside the route comparison, never inside it.</small>
              <br />
              <button type="button" className="link" onClick={() => onRemoveReport(report.id)}>
                {invented ? "Remove this example" : "Remove this report"}
              </button>
            </Popup>
          </Marker>
        );
      })}

      {start && (
        <Marker
          position={[start.lat, start.lng]}
          icon={cached(`A|${tone}`, () => startPin(tone))}
          draggable={movableEnds}
          zIndexOffset={1000}
          eventHandlers={{
            dragend: (event) => {
              const { lat, lng } = event.target.getLatLng();
              onMoveStart({ lat, lng });
            },
          }}
        />
      )}

      {end && (
        <Marker
          position={[end.lat, end.lng]}
          icon={cached(`B|${tone}`, () => endPin(tone))}
          draggable={movableEnds}
          zIndexOffset={1000}
          eventHandlers={{
            dragend: (event) => {
              const { lat, lng } = event.target.getLatLng();
              onMoveEnd({ lat, lng });
            },
          }}
        />
      )}
    </MapContainer>

    {/* One cluster, bottom-right, clear of the sheet — 44px each, where a thumb
        already is. */}
    <div className="map-tools">
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => map?.zoomIn()}>+</button>
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => map?.zoomOut()}>−</button>
      <button
        type="button"
        aria-label="Fit the routes on screen"
        title="Fit the routes on screen"
        disabled={routes.length === 0}
        onClick={refit}
      >
        ⤢
      </button>
    </div>
    </>
  );
}
