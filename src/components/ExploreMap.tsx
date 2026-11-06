"use client";

/**
 * The "Around me" map: reported places as dark grey DOTS shaded by how serious
 * they read (the reader's order, `importance.ts`), nearby places as pink
 * HEARTS, busy streets and bars when asked for, the selected area outlined in
 * blue. Street lighting and police areas sit in panes UNDER everything, so
 * they never hide a dot or a heart. No safety heatmap and no score colouring.
 *
 * Loaded with `ssr: false` from `ExploreBoard`; Leaflet cannot be
 * server-rendered.
 */

import {
  CircleMarker, MapContainer, Marker, Pane, Polygon, Polyline, Popup, Tooltip, useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo } from "react";

import { Basemap, crowdIcon, heartIcon, PANES, reportStyle, Resizer, ScaleBar, textIcon } from "@/components/mapBits";
import type { City } from "@/lib/cities";
import { rankOf, type ImportanceKey } from "@/lib/importance";
import type { LayerData, Spot } from "@/lib/layers";
import type { PlacedCrimeSummary } from "@/lib/nl-crime";
import type { LatLng } from "@/lib/osrm";
import { CROWD, LIGHT, NIGHTLIFE, pick, PLACE, POLICE, SELECTION, type Tone } from "@/lib/palette";
import type { Report } from "@/lib/reports";
import ReportCard from "@/components/ReportCard";

interface Props {
  city: City;
  tone: Tone;
  reports: Report[];
  /** Ids of reports the brush or the type focus has set aside — drawn faded. */
  faded: Set<string>;
  selectedDistricts: string[];
  onDistrict: (id: string) => void;
  layers: LayerData;
  showLighting: boolean;
  showPlaces: boolean;
  /** Busy streets and bars, when the crowd layers are on. */
  crowd: Spot[];
  /** The reader's order of what is most serious — the dots' shading. */
  order: ImportanceKey[];
  police: PlacedCrimeSummary[];
  openReport: string | null;
  onOpenReport: (id: string | null) => void;
  adding: boolean;
  onAdd: (point: LatLng) => void;
  onTiles: (ok: boolean) => void;
}

function Clicks({ adding, onAdd }: { adding: boolean; onAdd: (point: LatLng) => void }) {
  useMapEvents({
    click: (event) => {
      if (adding) onAdd({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}


export default function ExploreMap(props: Props) {
  const { city, tone, reports, faded, selectedDistricts, layers, police } = props;
  const selectionInk = pick(SELECTION, tone);
  const lightInk = pick(LIGHT, tone);
  const policeInk = pick(POLICE, tone);
  const heart = heartIcon(pick(PLACE, tone), 18);
  const ranked = useMemo(
    () => reports.map((report) => ({ report, rank: rankOf(report, props.order) })).sort((a, b) => b.rank - a.rank),
    [reports, props.order],
  );


  return (
    <MapContainer
      key={city.id}
      center={[city.centre.lat, city.centre.lng]}
      zoom={city.zoom}
      zoomControl={false}
      preferCanvas
      className={`map${props.adding ? " adding" : ""}`}
      attributionControl
    >
      <Basemap tone={tone} onFail={() => props.onTiles(false)} onOk={() => props.onTiles(true)} />
      <Resizer />
      <Clicks adding={props.adding} onAdd={props.onAdd} />

      {/* Police figures: a hatch-like neutral fill over the whole neighbourhood,
          under everything, never interactive — the least precise thing here. */}
      <Pane name="under" style={{ zIndex: PANES.under }}>
        {police.map((area) => area.rings?.map((ring, i) => (
          <Polygon
            key={`${area.areaCode}-${i}`}
            positions={ring.map((point) => [point.lat, point.lng])}
            pathOptions={{ color: policeInk, weight: 1, dashArray: "3 3", fillColor: policeInk, fillOpacity: 0.08 }}
            interactive={false}
          />
        )))}
      </Pane>

      {/* Lighting BELOW everything else: it used to sit on top and hide things. */}
      <Pane name="lighting" style={{ zIndex: PANES.lighting }}>
        {props.showLighting && layers.litWays.map((way) => (
          <Polyline
            key={way.id}
            positions={way.path.map((point) => [point.lat, point.lng])}
            pathOptions={{ color: lightInk, weight: 2.5, opacity: 0.7 }}
            interactive={false}
          />
        ))}
      </Pane>

      {city.districts.map((district) => {
        const on = selectedDistricts.includes(district.id);
        return (
          <Polygon
            key={district.id}
            positions={district.outline.map((point) => [point.lat, point.lng])}
            pathOptions={{
              color: on ? selectionInk : "transparent",
              weight: on ? 2 : 0,
              fillColor: selectionInk,
              fillOpacity: on ? 0.13 : 0,
            }}
            eventHandlers={{ click: () => { if (!props.adding) props.onDistrict(district.id); } }}
          />
        );
      })}
      {city.districts.map((district) => (
        <Marker
          key={`label-${district.id}`}
          position={[district.label.lat, district.label.lng]}
          icon={textIcon(`<span>${district.name.toUpperCase()}</span>`, "district-label")}
          interactive={false}
        />
      ))}

      {props.crowd.map((spot) => (
        <Marker key={spot.id} position={[spot.point.lat, spot.point.lng]} icon={crowdIcon(spot.kind === "bar" ? "bar" : "busy", pick(spot.kind === "bar" ? NIGHTLIFE : CROWD, tone))}>
          <Tooltip direction="top" offset={[0, -4]}>{spot.name ? `${spot.name} · ${spot.label}` : spot.label}</Tooltip>
        </Marker>
      ))}

      {props.showPlaces && layers.spots.map((spot) => (
        <Marker key={spot.id} position={[spot.point.lat, spot.point.lng]} icon={heart}>
          <Tooltip direction="top" offset={[0, -6]}>{spot.name ? `${spot.name} · ${spot.label}` : spot.label}</Tooltip>
        </Marker>
      ))}

      {/* Least serious first, so the serious ones are drawn on top. */}
      {ranked.map(({ report, rank }) => {
        const open = props.openReport === report.id;
        const style = reportStyle(rank, tone, { open, dim: faded.has(report.id), selectionInk });
        return (
          <CircleMarker key={report.id} center={[report.point.lat, report.point.lng]} radius={style.radius} pathOptions={style.pathOptions}>
            <Popup
              closeButton={false}
              className="report-pop"
              offset={[0, -4]}
              eventHandlers={{
                add: () => props.onOpenReport(report.id),
                remove: () => { if (props.openReport === report.id) props.onOpenReport(null); },
              }}
            >
              <ReportCard report={report} />
            </Popup>
          </CircleMarker>
        );
      })}

      <ScaleBar />
    </MapContainer>
  );
}
