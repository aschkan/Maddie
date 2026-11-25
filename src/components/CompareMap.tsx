"use client";

/**
 * Board 02's map: three routes told apart by COLOUR ONLY — every line solid,
 * the same width; the selected one at full opacity, the others at 80% (meeting
 * of 25 Nov 2026: no line style, nothing that makes one route look
 * recommended). Where two routes share a street they are drawn SIDE BY SIDE,
 * a few pixels apart, so three options read as three from start to
 * destination rather than one route that turns into another.
 *
 * The ends are labelled "Start" and "Destination" — not A and B, which
 * collided with Route A and Route B. Both can be set by a tap and dragged.
 *
 * Lighting is drawn only where it was loaded, and that area is OUTLINED, so an
 * empty street outside it is not read as dark, and a lit map inside it is not
 * read as "lit everywhere".
 *
 * Coordinated with the comparison below: tapping a route puts a cursor there
 * and the timeline marks the same point; moving along the timeline moves the
 * cursor here. Route lines do not bubble their clicks, so choosing a route
 * never moves an end.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Pane, Polyline, Popup, Rectangle, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { Basemap, crowdIcon, heartIcon, PANES, reportStyle, Resizer, ScaleBar, textIcon } from "@/components/mapBits";
import ReportCard from "@/components/ReportCard";
import { routeChipHtml } from "@/components/RouteChip";
import { rankOf, type ImportanceKey } from "@/lib/importance";
import type { TripEnd } from "@/lib/cities";
import { projectAlong, subPath } from "@/lib/evidence";
import { pathLengthM } from "@/lib/geo";
import type { LitWay, Spot } from "@/lib/layers";
import type { LatLng, Route } from "@/lib/osrm";
import { CROWD, LIGHT, NIGHTLIFE, pick, PLACE, ROUTE_INK, ROUTE_UNSELECTED_OPACITY, SELECTION, TRIP, type Tone } from "@/lib/palette";
import type { Report } from "@/lib/reports";

interface Props {
  tone: Tone;
  centre: LatLng;
  from: TripEnd;
  to: TripEnd;
  routes: Route[];
  hidden: boolean[];
  selected: number;
  onSelect: (index: number) => void;
  highlight: LatLng[];
  litWays: LitWay[];
  places: Spot[];
  reports: Report[];
  /** Busy streets and bars near the routes, when the crowd toggle is on. */
  crowd: Spot[];
  /** The reader's order of what is most serious — the dots' shading. */
  order: ImportanceKey[];
  onTiles: (ok: boolean) => void;
  /** Which end a tap on the map puts down. */
  placing: "A" | "B";
  onPlace: (letter: "A" | "B", point: LatLng) => void;
  /** Where lighting was loaded — outlined, because nothing is drawn outside it. */
  lightArea: { south: number; west: number; north: number; east: number } | null;
  /** The point being looked at, as a fraction along the selected route. */
  cursor: number | null;
  /** A tap on a route: which route, and how far along it. */
  onCursor: (route: number, at: number) => void;
}

/** Pixels between two routes drawn along the same street. */
const ROUTE_GAP_PX = 5;

/**
 * A path moved sideways by `offsetPx` screen pixels — so routes that share a
 * street sit next to each other instead of on top of one another. Recomputed
 * on every zoom, because a pixel is a different distance at each.
 */
function offsetPath(map: L.Map, path: LatLng[], offsetPx: number): [number, number][] {
  if (offsetPx === 0 || path.length < 2) return path.map((p) => [p.lat, p.lng]);
  const pts = path.map((p) => map.latLngToLayerPoint([p.lat, p.lng]));
  const normals = pts.map((_, k) => {
    const a = pts[Math.max(0, k - 1)]!;
    const b = pts[Math.min(pts.length - 1, k + 1)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return len > 0 ? { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } : null;
  });
  return pts.map((p, k) => {
    const normal = normals[k] ?? normals.find((n) => n !== null) ?? { x: 0, y: 0 };
    const at = map.layerPointToLatLng(L.point(p.x + normal.x * offsetPx, p.y + normal.y * offsetPx));
    return [at.lat, at.lng] as [number, number];
  });
}

function Routes({ routes, hidden, selected, tone, onSelect, onCursor }: {
  routes: Route[]; hidden: boolean[]; selected: number; tone: Tone;
  onSelect: (index: number) => void; onCursor: (route: number, at: number) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const shownKey = routes.map((_, i) => (hidden[i] ? "" : String(i))).join(",");
  const paths = useMemo(
    () => {
      const shown = routes.map((_, i) => i).filter((i) => !hidden[i]);
      return routes.map((route, i) => {
        const slot = shown.indexOf(i);
        return offsetPath(map, route.path, slot < 0 ? 0 : (slot - (shown.length - 1) / 2) * ROUTE_GAP_PX);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoom changes the pixel offset; shownKey captures `hidden`
    [map, routes, zoom, shownKey],
  );
  const shown = routes.map((_, i) => i).filter((i) => !hidden[i]);
  // The selected route is drawn last, on top; nothing else about it changes.
  const order = shown.filter((i) => i !== selected).concat(shown.includes(selected) ? [selected] : []);
  return (
    <>
      {order.map((i) => {
        const route = routes[i]!;
        return (
          <Polyline
            key={`${i}-${zoom}-${i === selected}`}
            positions={paths[i]!}
            pathOptions={{
              color: pick(ROUTE_INK[i] ?? ROUTE_INK[2]!, tone),
              weight: 4.5,
              opacity: i === selected ? 1 : ROUTE_UNSELECTED_OPACITY,
              lineCap: "round",
              lineJoin: "round",
              bubblingMouseEvents: false,
            }}
            eventHandlers={{
              click: (event) => {
                const total = pathLengthM(route.path);
                const { alongM } = projectAlong(route.path, { lat: event.latlng.lat, lng: event.latlng.lng });
                onSelect(i);
                onCursor(i, total > 0 ? Math.min(1, alongM / total) : 0);
              },
            }}
          />
        );
      })}
    </>
  );
}

/** The point a fraction of the way along a path, by length. */
function pointAlong(path: LatLng[], at: number): LatLng | null {
  const part = subPath(path, 0, Math.max(0.0001, Math.min(1, at)));
  return part[part.length - 1] ?? null;
}

function Taps({ placing, onPlace }: { placing: "A" | "B"; onPlace: Props["onPlace"] }) {
  useMapEvents({ click: (event) => onPlace(placing, { lat: event.latlng.lat, lng: event.latlng.lng }) });
  return null;
}

function Fit({ routes, from, to }: { routes: Route[]; from: TripEnd; to: TripEnd }) {
  const map = useMap();
  const key = routes.map((route) => route.path.length).join("|") + from.label + to.label;
  useEffect(() => {
    const points = routes.length > 0 ? routes.flatMap((route) => route.path) : [from.point, to.point];
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number]));
    if (!bounds.isValid()) return;
    // Only move the map when the trip no longer fits the view. Re-fitting on
    // EVERY change made the map jump the moment A was tapped, so the tap meant
    // for B landed somewhere else — it read as "A and B jump back".
    if (map.getBounds().pad(-0.04).contains(bounds)) return;
    map.fitBounds(bounds, { padding: [36, 36] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures what matters
  }, [map, key]);
  return null;
}

/** Where along a path to hang its label: a point a fraction of the way. */
function along(path: LatLng[], fraction: number): LatLng {
  return path[Math.min(path.length - 1, Math.max(0, Math.round((path.length - 1) * fraction)))]!;
}

export default function CompareMap(props: Props) {
  const { tone, routes, selected } = props;
  const trip = pick(TRIP, tone);
  const heart = heartIcon(pick(PLACE, tone), 15);
  const chosen = routes[selected];
  const cursorPoint = chosen && props.cursor !== null ? pointAlong(chosen.path, props.cursor) : null;
  const ranked = useMemo(
    () => props.reports.map((report) => ({ report, rank: rankOf(report, props.order) })).sort((a, b) => b.rank - a.rank),
    [props.reports, props.order],
  );

  return (
    <MapContainer
      center={[props.centre.lat, props.centre.lng]}
      zoom={13}
      zoomControl={false}
      preferCanvas
      className="map"
    >
      <Basemap tone={tone} onFail={() => props.onTiles(false)} onOk={() => props.onTiles(true)} />
      <Resizer />
      <Fit routes={routes} from={props.from} to={props.to} />
      <Taps placing={props.placing} onPlace={props.onPlace} />

      {/* Lighting in its own pane UNDER the routes, the places and the reports. */}
      <Pane name="lighting" style={{ zIndex: PANES.lighting }}>
        {props.litWays.map((way) => (
          <Polyline
            key={way.id}
            positions={way.path.map((point) => [point.lat, point.lng])}
            pathOptions={{ color: pick(LIGHT, tone), weight: 1.6, opacity: 0.5 }}
            interactive={false}
          />
        ))}
        {props.lightArea && (
          <Rectangle
            bounds={[[props.lightArea.south, props.lightArea.west], [props.lightArea.north, props.lightArea.east]]}
            pathOptions={{ color: trip, weight: 1.5, opacity: 0.55, dashArray: "6 6", fill: false }}
            interactive={false}
          />
        )}
      </Pane>

      {props.highlight.length > 1 && (
        <Polyline
          positions={props.highlight.map((point) => [point.lat, point.lng])}
          pathOptions={{ color: pick(SELECTION, tone), weight: 16, opacity: 0.28, lineCap: "butt" }}
          interactive={false}
        />
      )}

      <Routes routes={routes} hidden={props.hidden} selected={selected} tone={tone} onSelect={props.onSelect} onCursor={props.onCursor} />

      {routes.map((route, i) => (props.hidden[i] ? null : (
        <Marker
          key={`label-${i}-${i === selected}`}
          position={(() => { const p = along(route.path, 0.3 + i * 0.2); return [p.lat, p.lng] as [number, number]; })()}
          icon={textIcon(routeChipHtml(i, i === selected), "route-label")}
          eventHandlers={{ click: () => props.onSelect(i) }}
          zIndexOffset={i === selected ? 600 : 500}
        />
      )))}

      {cursorPoint && (
        <CircleMarker
          center={[cursorPoint.lat, cursorPoint.lng]}
          radius={8}
          pathOptions={{ color: trip, weight: 3, fillColor: tone === "night" ? "#0f172a" : "#ffffff", fillOpacity: 1 }}
          interactive={false}
        />
      )}

      {props.places.map((spot) => (
        <Marker key={spot.id} position={[spot.point.lat, spot.point.lng]} icon={heart} bubblingMouseEvents>
          <Tooltip direction="top" offset={[0, -5]}>{spot.name ? `${spot.name} · ${spot.label}` : spot.label}</Tooltip>
        </Marker>
      ))}

      {props.crowd.map((spot) => (
        <Marker key={spot.id} position={[spot.point.lat, spot.point.lng]} icon={crowdIcon(spot.kind === "bar" ? "bar" : "busy", pick(spot.kind === "bar" ? NIGHTLIFE : CROWD, tone))} bubblingMouseEvents>
          <Tooltip direction="top" offset={[0, -4]}>{spot.name ? `${spot.name} · ${spot.label}` : spot.label}</Tooltip>
        </Marker>
      ))}

      {/* Least serious first, so the serious ones are drawn on top. Tap one to read it. */}
      {ranked.map(({ report, rank }) => {
        const style = reportStyle(rank, tone);
        return (
          <CircleMarker
            key={report.id}
            center={[report.point.lat, report.point.lng]}
            radius={style.radius}
            pathOptions={{ ...style.pathOptions, bubblingMouseEvents: false }}
          >
            <Popup closeButton={false} className="report-pop" offset={[0, -4]}>
              <ReportCard report={report} />
            </Popup>
          </CircleMarker>
        );
      })}

      {[{ end: props.from, letter: "A", word: "Start" }, { end: props.to, letter: "B", word: "Destination" }].map(({ end, letter, word }) => (
        <Fragment key={letter}>
          <CircleMarker
            center={[end.point.lat, end.point.lng]}
            radius={7}
            pathOptions={{ color: tone === "night" ? "#0f172a" : "#ffffff", weight: 2, fillColor: trip, fillOpacity: 1 }}
          />
          <Marker
            position={[end.point.lat, end.point.lng]}
            icon={textIcon(`<span><b>${word}</b>${escape(end.label)}</span>`, `end-label end-${letter.toLowerCase()}`)}
            draggable
            eventHandlers={{
              dragend: (event) => {
                const at = (event.target as L.Marker).getLatLng();
                props.onPlace(letter as "A" | "B", { lat: at.lat, lng: at.lng });
              },
            }}
          />
        </Fragment>
      ))}

      <ScaleBar />
    </MapContainer>
  );
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
