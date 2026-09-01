"use client";

// TRAP: maplibre-gl has NO default export. Named imports only.
import { Map as MapLibreMap, Marker, NavigationControl, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";

export interface MapMarker {
  lat: number;
  lng: number;
  colour?: string;
  label?: string;
}

export interface MapLine {
  points: Array<{ lat: number; lng: number }>;
  colour?: string;
  width?: number;
}

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "/api/map/styles/liberty";

export function MapView({
  centre,
  zoom = 14,
  markers = [],
  lines = [],
  onPick,
  height = "22rem",
}: {
  centre: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
  lines?: MapLine[];
  onPick?: (point: { lat: number; lng: number }) => void;
  height?: string;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const drawn = useRef<Marker[]>([]);
  const pick = useRef(onPick);

  // Kept in an effect rather than assigned during render: a ref written while
  // rendering is a value React has not agreed to yet.
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (container.current === null || map.current !== null) return;
    const instance = new MapLibreMap({
      container: container.current,
      // The style is fetched through /api/map, and every URL inside it has
      // been rewritten to come back the same way — a browser on a blocked
      // network still gets ground under the markers.
      style: STYLE_URL as unknown as StyleSpecification | string,
      center: [centre.lng, centre.lat],
      zoom,
      attributionControl: { compact: true },
    });
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    instance.on("click", (event) => {
      pick.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng });
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, [centre.lat, centre.lng, zoom]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    instance.setCenter([centre.lng, centre.lat]);
  }, [centre.lat, centre.lng]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;
    for (const marker of drawn.current) marker.remove();
    drawn.current = markers.map((marker) =>
      new Marker({ color: marker.colour ?? "#b98cff" }).setLngLat([marker.lng, marker.lat]).addTo(instance),
    );
  }, [markers]);

  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;

    const draw = (): void => {
      for (let index = 0; index < 12; index += 1) {
        const id = `maddie-line-${index}`;
        if (instance.getLayer(id) !== undefined) instance.removeLayer(id);
        if (instance.getSource(id) !== undefined) instance.removeSource(id);
      }
      lines.forEach((line, index) => {
        const id = `maddie-line-${index}`;
        instance.addSource(id, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: line.points.map((point) => [point.lng, point.lat]) },
          },
        });
        instance.addLayer({
          id,
          type: "line",
          source: id,
          paint: { "line-color": line.colour ?? "#b98cff", "line-width": line.width ?? 4, "line-opacity": 0.9 },
        });
      });
    };

    if (instance.isStyleLoaded()) draw();
    else instance.once("load", draw);
  }, [lines]);

  return (
    <div
      ref={container}
      style={{ height }}
      className="w-full overflow-hidden rounded-xl border border-[var(--color-line)]"
    />
  );
}
