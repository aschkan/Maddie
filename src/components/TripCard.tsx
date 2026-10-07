"use client";

/**
 * Where you are walking from and to.
 *
 * It COLLAPSES once both ends are set, and that is the point of it. Two address
 * fields, two labels and two coordinate readouts is about 180px — a third of a
 * phone screen, permanently, for something you touch once at the start and then
 * never again. Collapsed it is one line you can still read and still tap.
 *
 * It floats over the map at phone width and over the map's corner from 900px
 * up; both are the same markup, because the suggestions dropdown has to escape
 * any scrolling container and this is never inside one.
 *
 * A and B are the trip's own INK — a hollow ring and a solid badge — never an
 * evidence colour. Green used to mean "start" here and "favourable" on the
 * line; purple meant "destination" here and "a report" on the map. See
 * `palette.ts` rule 2.
 *
 * In the STUDY SCENARIO the card is different: A is fixed at Utrecht Centraal,
 * B is one of three prepared destinations, chosen with a tap, and a chip says
 * the scenario is on for as long as it is. See `scenario.ts`.
 */

import { useEffect, useState } from "react";

import PlaceSearch from "@/components/PlaceSearch";
import type { Place } from "@/lib/geocode";
import type { LatLng } from "@/lib/osrm";
import type { ScenarioPlace } from "@/lib/scenario";

export interface ScenarioControls {
  start: ScenarioPlace;
  destinations: ScenarioPlace[];
  destinationId: string | null;
  onDestination: (id: string) => void;
  onLeave: () => void;
  /** When the routes were recorded. Shown in the chip's info. */
  recordedAt: string;
}

interface Props {
  start: LatLng | null;
  end: LatLng | null;
  startText: string;
  endText: string;
  onStartText: (text: string) => void;
  onEndText: (text: string) => void;
  onPickStart: (place: Place) => void;
  onPickEnd: (place: Place) => void;
  onClearStart: () => void;
  onClearEnd: () => void;
  onSwap: () => void;
  /** Which end the next map click will set, or null when both are set. */
  next: "A" | "B" | null;
  night: boolean;
  onNight: (on: boolean) => void;
  /** Present only while the study scenario is on. */
  scenario: ScenarioControls | null;
}

/** "52.37544, 4.88162" is not a place. A typed address is. */
function shorten(text: string, point: LatLng | null): string {
  if (text.trim()) return text.split(",").slice(0, 2).join(",").trim();
  if (point) return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
  return "";
}

export default function TripCard({
  start, end, startText, endText,
  onStartText, onEndText, onPickStart, onPickEnd, onClearStart, onClearEnd,
  onSwap, next, night, onNight, scenario,
}: Props) {
  // Open until there is something to collapse into.
  const [open, setOpen] = useState(true);
  const [about, setAbout] = useState(false);
  const both = start !== null && end !== null;
  const showFields = open || !both;

  /*
   * Fold away the moment both ends exist.
   *
   * That is the instant the card stops being a thing you use and starts being
   * a thing you glance at — and on a 390px screen it is also the instant the
   * answer arrives, with the card sitting on top of the map the answer is
   * about. Tapping "Change" reopens it, and it stays open then: `both` has not
   * changed, so this does not fire again underneath the person using it.
   */
  useEffect(() => {
    // In the IIFE like every other setState in an effect here — the React
    // Compiler lint rejects one reached synchronously from an effect body.
    void (async () => {
      if (both) setOpen(false);
    })();
  }, [both]);

  const destination = scenario?.destinations.find((place) => place.id === scenario.destinationId) ?? null;

  return (
    <div className="trip">
      <div className="trip-card">
        <div className="brand">
          <h1>Maddie</h1>
          {scenario ? (
            <button
              type="button"
              className="scenario-chip"
              aria-expanded={about}
              onClick={() => setAbout(!about)}
            >
              Study scenario <span className="lg-info" aria-hidden="true">i</span>
            </button>
          ) : (
            <span className="tagline">the ways round, compared</span>
          )}
          <button
            type="button"
            className="icon ghost"
            onClick={() => onNight(!night)}
            aria-pressed={night}
            title={night ? "Switch to day view" : "Switch to night view"}
            aria-label={night ? "Switch to day view" : "Switch to night view"}
          >
            {night ? "☀" : "☾"}
          </button>
        </div>

        {scenario && about && (
          <div className="scenario-about">
            <p>Everyone taking part sees exactly this: the same start, the same three destinations, the same routes
              and the same reports — so different choices can be compared.</p>
            <p>The routes and the map data were recorded from OpenStreetMap
              {scenario.recordedAt ? ` on ${new Date(scenario.recordedAt).toLocaleDateString()}` : ""}. The reports
              were prepared for this session and describe nothing that really happened.</p>
            <button type="button" className="ghost small" onClick={scenario.onLeave}>Leave the scenario</button>
          </div>
        )}

        {scenario && showFields ? (
          <div className="trip-fields">
            <div className="trip-end fixed">
              <span className="badge badge-a">A</span>
              <span>{scenario.start.label}</span>
              <small>{scenario.start.note}</small>
            </div>
            <div className="field-label"><span className="badge badge-b">B</span> Where are you going?</div>
            <div className="destinations" role="group" aria-label="Destination">
              {scenario.destinations.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  className={place.id === scenario.destinationId ? "dest on" : "dest"}
                  aria-pressed={place.id === scenario.destinationId}
                  onClick={() => scenario.onDestination(place.id)}
                >
                  <strong>{place.label}</strong>
                  <small>{place.note}</small>
                </button>
              ))}
            </div>
            {!destination && <p className="hint">Pick a destination to see the ways round.</p>}
            {destination && (
              <div className="row">
                <button type="button" className="ghost" onClick={() => setOpen(false)}>Done</button>
              </div>
            )}
          </div>
        ) : showFields ? (
          <div className="trip-fields">
            <PlaceSearch
              label="Start" badge="A" end="a"
              value={start} text={startText} onText={onStartText}
              onPick={onPickStart} onClear={onClearStart}
            />
            <PlaceSearch
              label="Destination" badge="B" end="b"
              value={end} text={endText} onText={onEndText}
              onPick={onPickEnd} onClear={onClearEnd}
            />

            <div className="row">
              <button type="button" className="ghost" onClick={onSwap} disabled={!start && !end}>
                ⇅ Swap
              </button>
              {both && (
                <button type="button" className="ghost" onClick={() => setOpen(false)}>
                  Done
                </button>
              )}
              {next && (
                <p className="hint" style={{ marginLeft: "auto" }}>
                  Tap the map to set <strong>{next}</strong>
                </p>
              )}
            </div>
          </div>
        ) : (
          <button type="button" className="trip-summary" onClick={() => setOpen(true)}>
            <span className="trip-ends">
              <span className="trip-end">
                <span className="badge badge-a">A</span>
                <span>{shorten(startText, start)}</span>
              </span>
              <span className="trip-end">
                <span className="badge badge-b">B</span>
                <span>{shorten(endText, end)}</span>
              </span>
            </span>
            <span className="trip-edit">Change</span>
          </button>
        )}
      </div>
    </div>
  );
}
