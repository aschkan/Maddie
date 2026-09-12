"use client";

/**
 * Where you are walking from and to.
 *
 * It COLLAPSES once both ends are set, and that is the point of it. Two address
 * fields, two labels and two coordinate readouts is about 180px — a third of a
 * phone screen, permanently, for something you touch once at the start and then
 * never again. Collapsed it is one line you can still read and still tap.
 *
 * It floats over the map at phone width and sits at the top of the sidebar from
 * 900px up; both are the same markup, because the suggestions dropdown has to
 * escape any scrolling container and this is never inside one.
 */

import { useEffect, useState } from "react";

import PlaceSearch from "@/components/PlaceSearch";
import type { Place } from "@/lib/geocode";
import type { LatLng } from "@/lib/osrm";

export const START_COLOUR = "#16a34a";
export const END_COLOUR = "#7c5cff";

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
  onSwap, next, night, onNight,
}: Props) {
  // Open until there is something to collapse into.
  const [open, setOpen] = useState(true);
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

  return (
    <div className="trip">
      <div className="trip-card">
        <div className="brand">
          <h1>Maddie</h1>
          <span className="tagline">the ways round, compared</span>
          <button
            type="button"
            className="icon ghost"
            onClick={() => onNight(!night)}
            aria-pressed={night}
            title={night ? "Switch to light mode" : "Switch to night mode"}
            aria-label={night ? "Switch to light mode" : "Switch to night mode"}
          >
            {night ? "☀" : "☾"}
          </button>
        </div>

        {showFields ? (
          <div className="trip-fields">
            <PlaceSearch
              label="Start" badge="A" accent={START_COLOUR}
              value={start} text={startText} onText={onStartText}
              onPick={onPickStart} onClear={onClearStart}
            />
            <PlaceSearch
              label="Destination" badge="B" accent={END_COLOUR}
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
                <span className="badge" style={{ background: START_COLOUR }}>A</span>
                <span>{shorten(startText, start)}</span>
              </span>
              <span className="trip-end">
                <span className="badge" style={{ background: END_COLOUR }}>B</span>
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
