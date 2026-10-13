"use client";

/**
 * Board 02's map: the routes as line STYLES the eye can tell apart without
 * colour (A solid, B dashed, C dotted), A and B as labelled black dots, and
 * the evidence near them — lit streets, nearby places, reports. The brushed
 * interval of the selected route is laid over it in the selection blue.
 */

import { Fragment, useEffect } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { Basemap, heartIcon, Resizer, ScaleBar, textIcon } from "@/components/mapBits";
import type { TripEnd } from "@/lib/cities";
import { routeLetter } from "@/lib/evidence";
import type { LitWay, Spot } from "@/lib/layers";
import type { LatLng, Route } from "@/lib/osrm";
import { LIGHT, pick, PLACE, REPORT, ROUTE_DASH, ROUTE_INK, SELECTION, TRIP, type Tone } from "@/lib/palette";
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
  onTiles: (ok: boolean) => void;
}

function Fit({ routes, from, to }: { routes: Route[]; from: TripEnd; to: TripEnd }) {
  const map = useMap();
  const key = routes.map((route) => route.path.length).join("|") + from.label + to.label;
  useEffect(() => {
    const points = routes.length > 0 ? routes.flatMap((route) => route.path) : [from.point, to.point];
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [36, 36] });
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

      {props.litWays.map((way) => (
        <Polyline
          key={way.id}
          positions={way.path.map((point) => [point.lat, point.lng])}
          pathOptions={{ color: pick(LIGHT, tone), weight: 1.6, opacity: 0.5 }}
          interactive={false}
        />
      ))}

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
        <Marker key={spot.id} position={[spot.point.lat, spot.point.lng]} icon={heart}>
          <Tooltip direction="top" offset={[0, -5]}>{spot.name ? `${spot.name} · ${spot.label}` : spot.label}</Tooltip>
        </Marker>
      ))}

      {props.reports.map((report) => (
        <CircleMarker
          key={report.id}
          center={[report.point.lat, report.point.lng]}
          radius={4}
          pathOptions={{ color: "#ffffff", weight: 0.8, fillColor: pick(REPORT, tone), fillOpacity: 0.95 }}
        />
      ))}

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
            interactive={false}
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
