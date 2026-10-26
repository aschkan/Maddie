"use client";

/**
 * The admin form's map: click to put the place, see where it is. Loaded with
 * `ssr: false` — Leaflet touches `window` at import.
 */

import { CircleMarker, MapContainer, useMap, useMapEvents } from "react-leaflet";
import { useEffect } from "react";
import "leaflet/dist/leaflet.css";

import { Basemap, Resizer } from "@/components/mapBits";
import type { LatLng } from "@/lib/osrm";
import { pick, REPORT } from "@/lib/palette";

function Clicks({ onPick }: { onPick: (point: LatLng) => void }) {
  useMapEvents({
    click: (event) => onPick({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) }),
  });
  return null;
}

/** Follow a point typed into the fields, so the map and the numbers agree. */
function Follow({ point }: { point: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.panTo([point.lat, point.lng]);
  }, [map, point]);
  return null;
}

export default function AdminMap({ point, onPick }: { point: LatLng | null; onPick: (point: LatLng) => void }) {
  return (
    <MapContainer
      center={point ? [point.lat, point.lng] : [52.2, 5.3]}
      zoom={point ? 15 : 7}
      className="map admin-map"
      zoomControl
    >
      <Basemap tone="day" />
      <Resizer />
      <Clicks onPick={onPick} />
      <Follow point={point} />
      {point && (
        <CircleMarker
          center={[point.lat, point.lng]}
          radius={8}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: pick(REPORT, "day"), fillOpacity: 1 }}
        />
      )}
    </MapContainer>
  );
}
