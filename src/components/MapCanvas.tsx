"use client";

/**
 * The Leaflet map.
 *
 * Loaded only in the browser — see RoutePlanner, which imports this with
 * `ssr: false`. Leaflet reaches for `window` at module scope, so rendering it
 * on the server fails at import time rather than at paint time, which makes the
 * error look unrelated to the map.
 */

import { useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { LatLng, Route } from "@/lib/osrm";

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

export interface MapCanvasProps {
  start: LatLng | null;
  end: LatLng | null;
  route: Route | null;
  centre: LatLng;
  /** A map click sets whichever point is next. */
  onPick: (point: LatLng) => void;
  onMoveStart: (point: LatLng) => void;
  onMoveEnd: (point: LatLng) => void;
  onTileError: () => void;
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
 * Keep the whole route in view.
 *
 * Only when the route itself changes — refitting on every render would fight
 * the user for control of the map the moment they panned away from it.
 */
function FitToRoute({ route }: { route: Route | null }) {
  const map = useMap();
  useEffect(() => {
    if (!route || route.path.length < 2) return;
    const bounds = L.latLngBounds(route.path.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48] });
  }, [map, route]);
  return null;
}

export default function MapCanvas({
  start, end, route, centre, onPick, onMoveStart, onMoveEnd, onTileError,
}: MapCanvasProps) {
  const startIcon = useMemo(() => pin("A", "#6ee7a8"), []);
  const endIcon = useMemo(() => pin("B", "#c084fc"), []);

  // One report is enough: a blocked tile host fires this for every tile in view.
  const [reported, setReported] = useState(false);

  return (
    <MapContainer
      center={[centre.lat, centre.lng]}
      zoom={13}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        // OpenStreetMap's own tiles. Free, no key, and their usage policy asks
        // that heavy users run their own — this is fine for a small app.
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

      <ClickToPick onPick={onPick} />
      <FitToRoute route={route} />

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

      {route && (
        <>
          {/* A dark casing under the line, so it stays readable over any tile. */}
          <Polyline positions={route.path.map((p) => [p.lat, p.lng])} color="#0b0d12" weight={9} opacity={0.55} />
          <Polyline positions={route.path.map((p) => [p.lat, p.lng])} color="#7c5cff" weight={5} />
        </>
      )}
    </MapContainer>
  );
}
