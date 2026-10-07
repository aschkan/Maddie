"use client";

/**
 * An address box that suggests places as you type.
 *
 * Nominatim asks for no more than one request per second, so this debounces and
 * keeps at most one request in flight — the previous one is aborted when you
 * keep typing. Firing on every keystroke is what gets an IP blocked.
 */

import { useEffect, useId, useRef, useState } from "react";

import { searchPlaces, type Place } from "@/lib/geocode";
import type { LatLng } from "@/lib/osrm";

interface Props {
  label: string;
  badge: string;
  /**
   * `a` or `b`. A class rather than a colour: the ends of a trip are drawn in
   * the trip's own ink, never in an evidence colour — see `palette.ts` rule 2.
   */
  end: "a" | "b";
  value: LatLng | null;
  text: string;
  onText: (text: string) => void;
  onPick: (place: Place) => void;
  onClear: () => void;
}

export default function PlaceSearch({ label, badge, end, value, text, onText, onPick, onClear }: Props) {
  const [hits, setHits] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Both fields are on screen at once, so the label has to point at its own
  // input — otherwise tapping "Destination" focuses the start box.
  const id = useId();

  useEffect(() => {
    const query = text.trim();
    const controller = new AbortController();

    // 500 ms: comfortably inside Nominatim's one-per-second policy while still
    // feeling immediate. Everything, including clearing the list for a short
    // query, happens in the timer — the React Compiler lint rejects a setState
    // reached synchronously from an effect body, and it is right to: that is a
    // cascading render on every keystroke.
    const timer = setTimeout(() => {
      void (async () => {
        if (query.length < 3) {
          setHits([]);
          setOpen(false);
          setBusy(false);
          setFailed(null);
          return;
        }
        setBusy(true);
        const outcome = await searchPlaces(query, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setHits(outcome.places);
        setOpen(outcome.places.length > 0);
        setFailed(outcome.error ?? null);
        setBusy(false);
      })();
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  // Clicking anywhere else puts the suggestions away.
  useEffect(() => {
    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  return (
    <div className="field" ref={box}>
      <label className="field-label" htmlFor={id}>
        <span className={`badge badge-${end}`}>{badge}</span>
        {label}
      </label>

      <div className="input-row">
        <input
          id={id}
          value={text}
          placeholder="Search an address, or tap the map"
          onChange={(event) => onText(event.target.value)}
          onFocus={() => setOpen(hits.length > 0)}
          spellCheck={false}
        />
        {value && (
          <button
            type="button"
            className="icon ghost"
            onClick={onClear}
            title={`Clear ${label.toLowerCase()}`}
            aria-label={`Clear ${label.toLowerCase()}`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Only when the point came from the map — under a typed address it is a
          second spelling of the same thing, in a panel with no room for one. */}
      {value && !text.trim() && (
        <p className="coords">{value.lat.toFixed(5)}, {value.lng.toFixed(5)}</p>
      )}
      {busy && <p className="coords">searching…</p>}
      {failed && !busy && <p className="search-failed">{failed}</p>}

      {open && hits.length > 0 && (
        <ul className="hits">
          {hits.map((hit) => (
            <li key={`${hit.point.lat},${hit.point.lng},${hit.label}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(hit);
                  setOpen(false);
                }}
              >
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
