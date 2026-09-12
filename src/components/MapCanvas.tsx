"use client";

/**
 * The Leaflet map.
 *
 * Loaded only in the browser — see RoutePlanner, which imports this with
 * `ssr: false`. Leaflet reaches for `window` at module scope, so rendering it
 * on the server fails at import time rather than at paint time, which makes the
 * error look unrelated to the map.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { LatLng, Route } from "@/lib/osrm";
import { alwaysOpen, type BBox, type LayerData } from "@/lib/layers";
import { CRIME_CATEGORIES, type Report } from "@/lib/reports";
import type { Segment } from "@/lib/segments";
import { VERDICT_COLOUR } from "@/lib/verdict";

/** The colours the brief names. Crime purple, safe spots pink, lighting yellow. */
export const CRIME = "#a855f7";
export const SAFE = "#ff5fa2";
export const LIGHT = "#f5c518";

/**
 * Pins drawn as inline SVG rather than Leaflet's own PNGs.
 *
 * Leaflet's default marker points at image files by relative path, and every
 * bundler rewrites those paths — which is why "my markers are invisible" is the
 * single most common react-leaflet question. A divIcon has no asset to lose,
 * and it lets A and B be told apart at a glance.
 */
function pin(letter: string, colour: string): L.DivIcon {
  return L.divIcon({
    className: "",           // Leaflet adds a white box without this
    html: `
      <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 41C15 41 28 25.5 28 15A13 13 0 1 0 2 15c0 10.5 13 26 13 26z"
              fill="${colour}" stroke="#0b0d12" stroke-width="2"/>
        <circle cx="15" cy="15" r="9" fill="#0b0d12"/>
        <text x="15" y="19.5" text-anchor="middle" font-size="12"
              font-family="system-ui, sans-serif" font-weight="700" fill="#fff">${letter}</text>
      </svg>`,
    iconSize: [30, 42],
    iconAnchor: [15, 41],    // the tip of the pin, not its middle
  });
}

/** The pink heart the brief asks for, with the category's own glyph inside. */
function heart(glyph: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <div class="spot-pin">
        <svg width="26" height="24" viewBox="0 0 26 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 22.5S1.5 15.4 1.5 8.3A6.3 6.3 0 0 1 13 4.6 6.3 6.3 0 0 1 24.5 8.3c0 7.1-11.5 14.2-11.5 14.2z"
                fill="${SAFE}" stroke="#4a0f2a" stroke-width="1.4"/>
        </svg>
        <span class="spot-glyph">${glyph}</span>
      </div>`,
    iconSize: [26, 24],
    iconAnchor: [13, 22],
  });
}

/**
 * One icon object per glyph, kept outside the component.
 *
 * Leaflet compares icons by identity, so building a new one each render makes
 * it tear down and rebuild every marker on the map on every keystroke.
 */
const HEARTS = new Map<string, L.DivIcon>();

function heartFor(glyph: string): L.DivIcon {
  const existing = HEARTS.get(glyph);
  if (existing) return existing;
  const made = heart(glyph);
  HEARTS.set(glyph, made);
  return made;
}

/**
 * A report someone entered: a solid purple dot.
 *
 * The example one below is deliberately NOT a colour variation. A fabricated
 * point on a real street has to be obviously not the same object as a real
 * report, at a glance, on a phone, in the dark — so it is hollow and dashed,
 * which reads as "outline, not filled in" rather than as another category.
 */
function crimePin(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="7.5" fill="${CRIME}" stroke="#1c0a2b" stroke-width="2"/>
        <path d="M10 5.6v5.2M10 13.6v.6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
      </svg>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function examplePin(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `
      <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="7" fill="none" stroke="${CRIME}"
                stroke-width="2" stroke-dasharray="3 2.6" opacity="0.85"/>
      </svg>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export interface MapCanvasProps {
  start: LatLng | null;
  end: LatLng | null;
  /** Every route OSRM offered. The selected one is drawn on top, in colour. */
  routes: Route[];
  selected: number;
  /**
   * The selected route cut into stretches, each with its own verdict.
   *
   * Empty while the route is still being read, and then the plain line is
   * drawn instead — an uncoloured route is "not read yet", which is true,
   * whereas colouring it all one comfortable shade would not be.
   */
  segments: Segment[];
  /** The stretch worth warning about, if there is one. Drawn with a halo. */
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
  reports: Report[];
  /** Dropping a report instead of a route point. */
  reportMode: boolean;
  onReport: (point: LatLng) => void;
  onRemoveReport: (id: string) => void;
  /** A map click sets whichever point is next. */
  onPick: (point: LatLng) => void;
  onMoveStart: (point: LatLng) => void;
  onMoveEnd: (point: LatLng) => void;
  onTileError: () => void;
  /** Fires after panning or zooming settles, with the new visible box. */
  onView: (view: { bbox: BBox; zoom: number }) => void;
  night: boolean;
}

/** Turns a click anywhere on the map into a point. */
function ClickToPick({ onPick }: { onPick: (point: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/**
 * Report the visible box, once things have stopped moving.
 *
 * Overpass hands out a couple of query slots per IP, so a query per frame of a
 * pan is the fastest way to a 429 that then blocks every other layer too.
 */
function WatchView({ onView }: { onView: MapCanvasProps["onView"] }) {
  const map = useMap();

  useEffect(() => {
    function report() {
      const bounds = map.getBounds();
      onView({
        bbox: {
          south: bounds.getSouth(), west: bounds.getWest(),
          north: bounds.getNorth(), east: bounds.getEast(),
        },
        zoom: map.getZoom(),
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
 */
function FitToRoute({ route, token, sheet }: { route: Route | undefined; token: number; sheet: string }) {
  const map = useMap();
  const key = route ? `${route.metres}:${route.path.length}` : "";

  useEffect(() => {
    if (!route || route.path.length < 2) return;
    const bounds = L.latLngBounds(route.path.map((p) => [p.lat, p.lng] as [number, number]));

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
         anchored at its tip and stands 41px above it, so fitting the LINE to
         the edge cuts the head off the pin at either end. */
      map.fitBounds(bounds, {
        paddingTopLeft: [26, top + 52],
        paddingBottomRight: [26, bottom + 52],
      });
    }, 260);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for the route's identity
  }, [map, key, token, sheet]);

  return null;
}

export default function MapCanvas({
  start, end, routes, selected, segments, highlight, sheetSnap, onSelectRoute, centre, layers, reports,
  reportMode, onReport, onRemoveReport,
  onPick, onMoveStart, onMoveEnd, onTileError, onView, night,
}: MapCanvasProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const refit = useCallback(() => setFitToken((n) => n + 1), []);

  const startIcon = useMemo(() => pin("A", "#16a34a"), []);
  const endIcon = useMemo(() => pin("B", "#7c5cff"), []);
  const alert = useMemo(() => crimePin(), []);
  const example = useMemo(() => examplePin(), []);

  // One report is enough: a blocked tile host fires this for every tile in view.
  const [reported, setReported] = useState(false);

  const categoryLabel = useMemo(
    () => new Map(CRIME_CATEGORIES.map((c) => [c.id, c.label])),
    [],
  );

  return (
    <>
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
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        // OpenStreetMap's own tiles. Free, no key, and their usage policy asks
        // that heavy users run their own — this is fine for a small app.
        //
        // Night mode inverts these in CSS rather than switching to a dark tile
        // host. A second provider is a second thing that can be unreachable,
        // and a map whose background silently fails to load is the worst
        // possible way to render a page about walking somewhere after dark.
        className={night ? "tiles-night" : ""}
        url={process.env.NEXT_PUBLIC_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
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
      <WatchView onView={onView} />
      <FitToRoute route={routes[selected]} token={fitToken} sheet={sheetSnap} />

      {/* ── lighting ─────────────────────────────────────────────────────── */}
      {layers.litWays.map((way) => (
        <Polyline
          key={way.id}
          positions={way.path.map((p) => [p.lat, p.lng])}
          color={LIGHT}
          weight={4}
          opacity={0.55}
        />
      ))}
      {layers.lamps.map((lamp) => (
        <CircleMarker
          key={lamp.id}
          center={[lamp.point.lat, lamp.point.lng]}
          radius={2.5}
          pathOptions={{ color: LIGHT, fillColor: LIGHT, fillOpacity: 0.9, weight: 0 }}
        />
      ))}

      {/* ── the routes ───────────────────────────────────────────────────── */}
      {routes.map((route, index) => {
        if (index === selected) return null;
        return (
          <Polyline
            key={`alt-${index}`}
            positions={route.path.map((p) => [p.lat, p.lng])}
            color="#8892a6"
            weight={5}
            opacity={0.6}
            dashArray="1 9"
            eventHandlers={{ click: () => onSelectRoute(index) }}
          />
        );
      })}
      {routes[selected] && (
        <>
          {/* A dark casing under the line, so it stays readable over any tile. */}
          <Polyline
            positions={routes[selected].path.map((p) => [p.lat, p.lng])}
            color="#0b0d12" weight={9} opacity={0.5}
          />

          {/* The stretch the panel names, widened so it can be found by eye.
              Under the coloured segments, not over them: a halo that hid the
              verdict colour would replace the answer with a pointer to it. */}
          {highlight && (
            <Polyline
              positions={highlight.path.map((p) => [p.lat, p.lng])}
              color={VERDICT_COLOUR[highlight.verdict]}
              weight={17}
              opacity={0.3}
            />
          )}

          {/* Coloured by stretch once the route has been read. Grey stretches
              are ones OpenStreetMap says too little about — not dark ones. */}
          {segments.length > 0 ? (
            segments.map((segment) => (
              <Polyline
                key={`seg-${segment.fromM}`}
                positions={segment.path.map((p) => [p.lat, p.lng])}
                color={VERDICT_COLOUR[segment.verdict]}
                weight={5}
              />
            ))
          ) : (
            <Polyline
              positions={routes[selected].path.map((p) => [p.lat, p.lng])}
              color="#7c5cff" weight={5}
            />
          )}
        </>
      )}

      {/* ── safe spots ───────────────────────────────────────────────────── */}
      {layers.spots.map((spot) => (
        <Marker key={spot.id} position={[spot.point.lat, spot.point.lng]} icon={heartFor(spot.icon)}>
          <Popup>
            <strong>{spot.name ?? spot.label}</strong>
            <br />
            {spot.label}
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

      {/* ── reports ──────────────────────────────────────────────────────── */}
      {reports.map((report) => {
        const invented = report.source === "example";
        return (
          <Marker
            key={report.id}
            position={[report.point.lat, report.point.lng]}
            icon={invented ? example : alert}
          >
            <Popup>
              {/* First line, before the category: whatever else the reader
                  takes from this popup, they take that this did not happen. */}
              {invented && <><span className="example-tag">EXAMPLE DATA — NOT A REAL REPORT</span><br /></>}
              <strong>{categoryLabel.get(report.category) ?? report.category}</strong>
              <br />
              {new Date(report.at).toLocaleString()}
              {report.area && <><br />scattered in {report.area}</>}
              {report.note && <><br />{report.note}</>}
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
          icon={startIcon}
          draggable
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
          icon={endIcon}
          draggable
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
        aria-label="Fit the route on screen"
        title="Fit the route on screen"
        disabled={!routes[selected]}
        onClick={refit}
      >
        ⤢
      </button>
    </div>
    </>
  );
}
