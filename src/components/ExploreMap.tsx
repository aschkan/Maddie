"use client";

/**
 * Board 01's map: community reports as purple DOTS, nearby places as pink
 * HEARTS, the selected area outlined in blue, district names in spaced
 * capitals. No safety heatmap and no score colouring — the map shows records,
 * the charts beside it count them.
 *
 * Loaded with `ssr: false` from `ExploreBoard`; Leaflet cannot be
 * server-rendered.
 */

import { useMemo } from "react";
import {
  CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, Tooltip, useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { Basemap, heartIcon, Resizer, ScaleBar, textIcon } from "@/components/mapBits";
import type { City } from "@/lib/cities";
import { hourOf, REPORT_TYPES, reportType, timeOfDay } from "@/lib/evidence";
import type { LayerData } from "@/lib/layers";
import type { PlacedCrimeSummary } from "@/lib/nl-crime";
import type { LatLng } from "@/lib/osrm";
import { LIGHT, pick, PLACE, POLICE, REPORT, SELECTION, type Tone } from "@/lib/palette";
import type { Report } from "@/lib/reports";

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

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export default function ExploreMap(props: Props) {
  const { city, tone, reports, faded, selectedDistricts, layers, police } = props;
  const reportInk = pick(REPORT, tone);
  const selectionInk = pick(SELECTION, tone);
  const lightInk = pick(LIGHT, tone);
  const policeInk = pick(POLICE, tone);
  const heart = heartIcon(pick(PLACE, tone), 18);

  const typeLabel = useMemo(() => new Map(REPORT_TYPES.map((type) => [type.id, type.label])), []);

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
      {police.map((area) => area.rings?.map((ring, i) => (
        <Polygon
          key={`${area.areaCode}-${i}`}
          positions={ring.map((point) => [point.lat, point.lng])}
          pathOptions={{ color: policeInk, weight: 1, dashArray: "3 3", fillColor: policeInk, fillOpacity: 0.08 }}
          interactive={false}
        />
      )))}

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

      {props.showLighting && layers.litWays.map((way) => (
        <Polyline
          key={way.id}
          positions={way.path.map((point) => [point.lat, point.lng])}
          pathOptions={{ color: lightInk, weight: 2.5, opacity: 0.85 }}
          interactive={false}
        />
      ))}

      {props.showPlaces && layers.spots.map((spot) => (
        <Marker key={spot.id} position={[spot.point.lat, spot.point.lng]} icon={heart}>
          <Tooltip direction="top" offset={[0, -6]}>{spot.name ? `${spot.name} · ${spot.label}` : spot.label}</Tooltip>
        </Marker>
      ))}

      {reports.map((report) => {
        const dim = faded.has(report.id);
        const open = props.openReport === report.id;
        return (
          <CircleMarker
            key={report.id}
            center={[report.point.lat, report.point.lng]}
            radius={open ? 7 : 4.5}
            pathOptions={{
              color: open ? selectionInk : "#ffffff",
              weight: open ? 3 : 0.8,
              fillColor: reportInk,
              fillOpacity: dim ? 0.18 : 0.92,
              opacity: dim ? 0.2 : 1,
            }}
          >
            <Popup
              closeButton={false}
              className="report-pop"
              offset={[0, -4]}
              eventHandlers={{
                add: () => props.onOpenReport(report.id),
                remove: () => { if (props.openReport === report.id) props.onOpenReport(null); },
              }}
            >
                <b>{report.source === "example" ? "Example report" : "Community report"}</b>
                <span>
                  {timeOfDay(hourOf(report))} · {typeLabel.get(reportType(report.category))}
                </span>
                <span>{DATE.format(new Date(report.at))}, {TIME.format(new Date(report.at))}</span>
              {report.note && <q>{report.note}</q>}
            </Popup>
          </CircleMarker>
        );
      })}

      <ScaleBar />
    </MapContainer>
  );
}
