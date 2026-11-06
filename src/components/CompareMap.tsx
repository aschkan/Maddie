"use client";

/**
 * Board 02's map: the routes as line STYLES the eye can tell apart without
 * colour (A solid, B dashed, C dotted), A and B as labelled black dots, and
 * the evidence near them — lit streets, nearby places, reports. The brushed
 * interval of the selected route is laid over it in the selection blue.
 *
 * A and B are set ON the map as well as by search: a tap puts down whichever
 * end `placing` names, and both dots can be dragged. Search alone made the trip
 * a choice from a fixed list whenever Nominatim was unreachable, which from
 * these servers is often. Route lines do not bubble their clicks, so choosing a
 * route never moves an end.
 */

import { Fragment, useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Pane, Polyline, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { Basemap, crowdIcon, heartIcon, PANES, reportStyle, Resizer, ScaleBar, textIcon } from "@/components/mapBits";
import ReportCard from "@/components/ReportCard";
import { rankOf, type ImportanceKey } from "@/lib/importance";
import type { TripEnd } from "@/lib/cities";
import { routeLetter } from "@/lib/evidence";
import type { LitWay, Spot } from "@/lib/layers";
import type { LatLng, Route } from "@/lib/osrm";
import { CROWD, LIGHT, NIGHTLIFE, pick, PLACE, ROUTE_DASH, ROUTE_INK, SELECTION, TRIP, type Tone } from "@/lib/palette";
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
  const order = routes.map((_, i) => i).filter((i) => i !== selected).concat(routes[selected] ? [selected] : []);
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
      </Pane>

      {props.highlight.length > 1 && (
        <Polyline
          positions={props.highlight.map((point) => [point.lat, point.lng])}
          pathOptions={{ color: pick(SELECTION, tone), weight: 16, opacity: 0.28, lineCap: "butt" }}
          interactive={false}
        />
      )}

      {order.map((i) => {
        const route = routes[i]!;
        if (props.hidden[i]) return null;
        const ink = pick(ROUTE_INK[i] ?? ROUTE_INK[2]!, tone);
        const on = i === selected;
        return (
          <Polyline
            key={i}
            positions={route.path.map((point) => [point.lat, point.lng])}
            pathOptions={{
              color: ink,
              weight: on ? 5 : 3.5,
              opacity: on ? 1 : 0.85,
              dashArray: ROUTE_DASH[i],
              lineCap: ROUTE_DASH[i] ? "butt" : "round",
              bubblingMouseEvents: false,
            }}
            eventHandlers={{ click: () => props.onSelect(i) }}
          />
        );
      })}

      {routes.map((route, i) => (props.hidden[i] ? null : (
        <Marker
          key={`label-${i}`}
          position={(() => { const p = along(route.path, 0.5 + i * 0.1); return [p.lat, p.lng] as [number, number]; })()}
          icon={textIcon(`<span class="r${i}">Route ${routeLetter(i)}</span>`, "route-label")}
          eventHandlers={{ click: () => props.onSelect(i) }}
        />
      )))}

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

      {[{ end: props.from, letter: "A" }, { end: props.to, letter: "B" }].map(({ end, letter }) => (
        <Fragment key={letter}>
          <CircleMarker
            center={[end.point.lat, end.point.lng]}
            radius={7}
            pathOptions={{ color: tone === "night" ? "#0f172a" : "#ffffff", weight: 2, fillColor: trip, fillOpacity: 1 }}
          />
          <Marker
            position={[end.point.lat, end.point.lng]}
            icon={textIcon(`<span><b>${letter}</b>${escape(end.label)}</span>`, `end-label end-${letter.toLowerCase()}`)}
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
