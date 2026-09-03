"use client";

/**
 * Pick two points, get a route.
 *
 * The map is imported with `ssr: false` and that has to happen from a CLIENT
 * component: `next/dynamic` refuses to disable SSR from a server component, and
 * Leaflet cannot be server-rendered at all — it touches `window` while the
 * module is still being evaluated.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import PlaceSearch from "@/components/PlaceSearch";
import SafetyPanel from "@/components/SafetyPanel";
import type { Place } from "@/lib/geocode";
import { fetchRoute, PROFILES, type LatLng, type Profile, type Route } from "@/lib/osrm";
import { formatDistance, formatDuration } from "@/lib/format";

const MapCanvas = dynamic(() => import("@/components/MapCanvas"), {
  ssr: false,
  loading: () => <div className="map-loading">Loading the map…</div>,
});

const AMSTERDAM: LatLng = { lat: 52.3728, lng: 4.8936 };

const PROFILE_LABEL: Record<Profile, string> = {
  driving: "Drive",
  walking: "Walk",
  cycling: "Cycle",
};

/** Written out rather than derived: "drive" + "ing" is "driveing". */
const PROFILE_TIME: Record<Profile, string> = {
  driving: "driving time",
  walking: "walking time",
  cycling: "cycling time",
};

export default function RoutePlanner() {
  const [start, setStart] = useState<LatLng | null>(null);
  const [end, setEnd] = useState<LatLng | null>(null);
  const [startText, setStartText] = useState("");
  const [endText, setEndText] = useState("");
  const [profile, setProfile] = useState<Profile>("driving");
  // The safety read turns almost entirely on whether it is dark, so the hour is
  // something you set rather than something the page assumes.
  const [hour, setHour] = useState<number>(() => new Date().getHours());

  const [route, setRoute] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);

  // So a slow reply for an old pair cannot overwrite a newer one.
  const inFlight = useRef<AbortController | null>(null);

  /** A click drops A first, then B, then starts again from A. */
  const pick = useCallback((point: LatLng) => {
    const here = `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
    setStart((currentStart) => {
      if (currentStart === null) {
        setStartText(here);
        return point;
      }
      setEnd((currentEnd) => {
        if (currentEnd === null) {
          setEndText(here);
          return point;
        }
        return currentEnd;
      });
      return currentStart;
    });
  }, []);

  // Re-route whenever the pair or the profile changes.
  useEffect(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    // Every setState lives inside this, including the "no pair yet" reset: the
    // React Compiler lint rejects one reached synchronously from an effect
    // body, because that is a second render before the first has painted.
    void (async () => {
      if (!start || !end) {
        setRoute(null);
        setError(null);
        setBusy(false);
        return;
      }
      setBusy(true);
      const result = await fetchRoute(start, end, profile, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setBusy(false);
      if (result.ok) {
        setRoute(result.route);
        setError(null);
      } else {
        setRoute(null);
        // An abort is us replacing the request, not a failure worth showing.
        setError(result.error === "cancelled" ? null : result.error);
      }
    })();

    return () => controller.abort();
  }, [start, end, profile]);

  const centre = useMemo(() => start ?? end ?? AMSTERDAM, [start, end]);

  const usePlace = (which: "start" | "end") => (place: Place) => {
    if (which === "start") {
      setStart(place.point);
      setStartText(place.label);
    } else {
      setEnd(place.point);
      setEndText(place.label);
    }
  };

  const swap = () => {
    setStart(end);
    setEnd(start);
    setStartText(endText);
    setEndText(startText);
  };

  const next = start === null ? "A" : end === null ? "B" : null;

  return (
    <div className="layout">
      <aside className="panel">
        <header>
          <h1>Route</h1>
          <p>
            Click the map to drop <strong>A</strong>, then <strong>B</strong> — or search for an
            address. Drag either pin to move it.
          </p>
        </header>

        <PlaceSearch
          label="Start" badge="A" accent="#6ee7a8"
          value={start} text={startText} onText={setStartText}
          onPick={usePlace("start")}
          onClear={() => { setStart(null); setStartText(""); }}
        />

        <PlaceSearch
          label="Destination" badge="B" accent="#c084fc"
          value={end} text={endText} onText={setEndText}
          onPick={usePlace("end")}
          onClear={() => { setEnd(null); setEndText(""); }}
        />

        <div className="row">
          <div className="profiles" role="group" aria-label="Travel mode">
            {PROFILES.map((option) => (
              <button
                key={option}
                type="button"
                className={option === profile ? "on" : ""}
                onClick={() => setProfile(option)}
              >
                {PROFILE_LABEL[option]}
              </button>
            ))}
          </div>
          <button type="button" className="ghost" onClick={swap} disabled={!start && !end}>
            ⇅ Swap
          </button>
        </div>

        {next && (
          <p className="hint">Click the map to place <strong>{next}</strong>.</p>
        )}

        {busy && <p className="hint">Finding a route…</p>}

        <div className="row">
          <label className="when">
            Walking at
            <select value={hour} onChange={(event) => setHour(Number(event.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </label>
        </div>

        {route && !busy && (
          <div className="summary">
            <div><span>{formatDistance(route.metres)}</span><small>distance</small></div>
            <div><span>{formatDuration(route.seconds)}</span><small>{PROFILE_TIME[profile]}</small></div>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        {!busy && <SafetyPanel route={route} hour={hour} />}

        {tilesFailed && (
          <p className="error">
            The map tiles could not be loaded, so the background is blank. Everything else still
            works — that is a gap in what this browser can reach, not an empty map.
          </p>
        )}

        <footer>
          Routing by <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a>,
          search by <a href="https://nominatim.org/" target="_blank" rel="noreferrer">Nominatim</a>,
          map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.
        </footer>
      </aside>

      <main className="map">
        <MapCanvas
          start={start}
          end={end}
          route={route}
          centre={centre}
          onPick={pick}
          onMoveStart={setStart}
          onMoveEnd={setEnd}
          onTileError={() => setTilesFailed(true)}
        />
      </main>
    </div>
  );
}
