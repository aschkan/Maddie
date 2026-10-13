"use client";

/**
 * One end of the trip, as a field in the Compare board's top bar: an icon, a
 * label, the place, and suggestions.
 *
 * Suggestions are the city's PRESETS when the field is empty (in Utrecht those
 * are the study scenario's recorded places, which need no network), and
 * Nominatim hits while typing — at most one search per 500 ms, inside its
 * one-per-second policy.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, MapPin } from "lucide-react";

import type { TripEnd } from "@/lib/cities";
import { searchPlaces } from "@/lib/geocode";

interface Props {
  label: string;
  letter: "A" | "B";
  value: TripEnd;
  presets: TripEnd[];
  onPick: (end: TripEnd) => void;
}

export default function PlaceField({ label, letter, value, presets, onPick }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [hits, setHits] = useState<TripEnd[]>([]);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const query = (text ?? "").trim();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        if (query.length < 3) {
          setHits([]);
          setNote(null);
          return;
        }
        setNote("searching…");
        const outcome = await searchPlaces(query, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setHits(outcome.places.map((place) => ({ label: place.label, point: place.point })));
        setNote(outcome.error ?? (outcome.places.length === 0 ? "No match" : null));
      })();
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  useEffect(() => {
    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) {
        setOpen(false);
        setText(null);
      }
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const list = text && text.trim().length >= 3 ? hits : presets;

  return (
    <div className="trip-field" ref={box}>
      <label htmlFor={id}>{label}</label>
      <div className="trip-input">
        <MapPin size={16} aria-hidden />
        <input
          id={id}
          value={text ?? `${letter}. ${value.label}`}
          onFocus={() => { setText(""); setOpen(true); }}
          onChange={(event) => { setText(event.target.value); setOpen(true); }}
          spellCheck={false}
          autoComplete="off"
        />
        <ChevronDown size={16} aria-hidden className="chev" />
      </div>
      {open && (
        <ul className="hits">
          {note && <li className="hit-note">{note}</li>}
          {list.map((hit) => (
            <li key={`${hit.label}|${hit.point.lat}|${hit.point.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(hit);
                  setOpen(false);
                  setText(null);
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
