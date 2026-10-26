"use client";

/**
 * Pieces both maps use. Imported only from the map components, which are
 * themselves loaded with `ssr: false` — Leaflet touches `window` at import.
 */

import { useEffect, useState } from "react";
import { TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

import { endpoint } from "@/lib/endpoints";
import type { Tone } from "@/lib/palette";

/** Tiles come through this server by default — see `endpoints.ts`. */
const TILE_URL = endpoint("tile");

export function Basemap({ tone, onFail, onOk }: { tone: Tone; onFail?: () => void; onOk?: () => void }) {
  return (
    <TileLayer
      url={TILE_URL}
      // Dutch tiles come from the study PC's OpenMapTiles build, whose licence asks for this credit.
      attribution='&copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      className={tone === "night" ? "tiles-night" : "tiles-day"}
      maxZoom={19}
      eventHandlers={{ tileerror: () => onFail?.(), tileload: () => onOk?.() }}
    />
  );
}

/**
 * A scale bar drawn like the boards' axes: 0, 1, 2 km. Leaflet's own control
 * draws one box with one number, which reads as UI chrome, not as a scale.
 */
export function ScaleBar() {
  const map = useMap();
  const [metresPerPx, setMetresPerPx] = useState(() => perPx(map));
  useMapEvents({ zoomend: () => setMetresPerPx(perPx(map)), moveend: () => setMetresPerPx(perPx(map)) });

  const target = 110 * metresPerPx;
  const unit = [50, 100, 200, 250, 500, 1000, 2000, 5000, 10000].find((u) => u * 2 >= target) ?? 10000;
  const step = unit / metresPerPx;
  const label = (m: number) => (unit >= 1000 ? `${m / 1000}` : `${m}`);
  return (
    <div className="scale-bar" aria-hidden>
      <div className="scale-ticks" style={{ width: step * 2 }}>
        <span style={{ left: 0 }}>0</span>
        <span style={{ left: step }}>{label(unit)}</span>
        <span style={{ left: step * 2 }}>{label(unit * 2)} {unit >= 1000 ? "km" : "m"}</span>
      </div>
      <div className="scale-line" style={{ width: step * 2 }}>
        <i style={{ width: step }} />
      </div>
    </div>
  );
}

function perPx(map: L.Map): number {
  const centre = map.getCenter();
  return (40_075_016.686 * Math.cos((centre.lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
}

/** Keeps Leaflet's idea of its size right when the grid around it changes. */
export function Resizer() {
  const map = useMap();
  useEffect(() => {
    const node = map.getContainer();
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(node);
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/* ── icons — cached at module scope, because Leaflet compares by identity ── */

const HEART_PATH = "M12 21s-6.7-4.35-9.33-8.1C.6 9.95 2.02 5.5 6.04 5.5c2.3 0 3.6 1.4 4.46 2.66.86-1.26 2.16-2.66 4.46-2.66 4.02 0 5.44 4.45 3.37 7.4C18.7 16.65 12 21 12 21z";
const hearts = new Map<string, L.DivIcon>();

export function heartIcon(colour: string, size = 18): L.DivIcon {
  const key = `${colour}|${size}`;
  let icon = hearts.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: "heart-icon",
      html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${HEART_PATH}" fill="${colour}" stroke="white" stroke-width="1.6"/></svg>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
    hearts.set(key, icon);
  }
  return icon;
}

const labels = new Map<string, L.DivIcon>();

/** A text label on the map — district names, route names, A and B. */
export function textIcon(html: string, className: string): L.DivIcon {
  const key = `${className}|${html}`;
  let icon = labels.get(key);
  if (!icon) {
    icon = L.divIcon({ className, html, iconSize: undefined as unknown as L.PointExpression, iconAnchor: [0, 0] });
    labels.set(key, icon);
  }
  return icon;
}
