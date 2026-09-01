"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapView } from "@/components/MapView";
import { Card, DimensionList, Field, GapNotice, ScoreBadge, buttonClass, inputClass } from "@/components/ui";
import { DEFAULT_CENTRE, fromLocalInput, getJson, metres, nightSelected, toLocalInput } from "@/lib/client";
import type { PlaceSearchResult, RankedPlace } from "@/lib/scoring/places";
import type { GeoPlace } from "@/lib/sources/pdok";

interface GeocodeBody {
  status: string;
  places: GeoPlace[];
  note: string | null;
}

const SUGGESTIONS = ["pharmacy", "late food", "shop open now", "way home", "somewhere to get help"];

export default function ExplorePage() {
  const [query, setQuery] = useState("pharmacy");
  const [where, setWhere] = useState("");
  const [centre, setCentre] = useState(DEFAULT_CENTRE);
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [result, setResult] = useState<PlaceSearchResult | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const at = useMemo(() => fromLocalInput(when), [when]);

  const search = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const url = `/api/places/search?q=${encodeURIComponent(query)}&lat=${centre.lat}&lng=${centre.lng}&at=${encodeURIComponent(at.toISOString())}`;
      const { body } = await getJson<PlaceSearchResult>(url);
      setResult(body);
    } catch {
      // The page itself could not reach its own API. That is still a gap, and
      // it must not look like an empty neighbourhood.
      setFailure("This page could not reach the server, so nothing was searched. This is not a claim that there is nothing here.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [query, centre.lat, centre.lng, at]);

  useEffect(() => {
    // First paint only; the button and the map drive every search after that.
    void (async () => {
      await search();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findWhere = async (): Promise<void> => {
    if (where.trim() === "") return;
    const { body } = await getJson<GeocodeBody>(`/api/geocode?q=${encodeURIComponent(where)}`);
    const first = body.places[0];
    if (first !== undefined) setCentre(first.point);
    else setFailure(body.note ?? "That place could not be found.");
  };

  const markers = useMemo(
    () => [
      { lat: centre.lat, lng: centre.lng, colour: "#ffffff", label: "You" },
      ...(result?.places ?? []).map((place) => ({
        lat: place.point.lat,
        lng: place.point.lng,
        colour: bandColour(place.band),
      })),
    ],
    [centre, result],
  );

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Is this place safe, at this hour?
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          Places ranked by what the walk there and back is like {nightSelected(at) ? "after dark" : "at this time of day"} — not by
          how good they are.
        </p>
      </header>

      <Card className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1.2fr_1.2fr_1fr_auto]">
          <Field label="Looking for">
            <input className={inputClass} value={query} onChange={(event) => setQuery(event.target.value)} />
          </Field>
          <Field label="Near">
            <div className="flex gap-2">
              <input
                className={inputClass}
                placeholder="an address, or click the map"
                value={where}
                onChange={(event) => setWhere(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void findWhere();
                }}
              />
              <button type="button" onClick={() => void findWhere()} className="rounded-lg border border-[var(--color-line)] px-3 text-xs">
                Find
              </button>
            </div>
          </Field>
          <Field label="At">
            <input
              type="datetime-local"
              className={inputClass}
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <button type="button" className={buttonClass} onClick={() => void search()} disabled={loading}>
              {loading ? "Looking…" : "Search"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setQuery(suggestion)}
              className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-paper)]"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </Card>

      <MapView centre={centre} markers={markers} onPick={setCentre} />

      {failure !== null ? <GapNotice gaps={[failure]} title="What went wrong" /> : null}

      {result !== null ? (
        <>
          {result.coverage === "none" ? (
            <GapNotice
              gaps={[
                result.note ??
                  "No map data could be loaded, so nothing was searched. This is not a claim that there is nothing here.",
                ...result.gaps,
              ]}
              title="Nothing was searched"
            />
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  {result.places.length} places, safest first
                </h2>
                <span className="text-xs text-[var(--color-muted)]">
                  {result.coverage === "partial" ? "Some map data did not arrive" : "Map data complete"}
                </span>
              </div>

              {result.places.length === 0 ? (
                <Card>
                  <p className="text-sm">{result.note}</p>
                </Card>
              ) : (
                <ul className="space-y-3">
                  {result.places.map((place) => (
                    <PlaceRow
                      key={place.id}
                      place={place}
                      open={expanded === place.id}
                      onToggle={() => setExpanded(expanded === place.id ? null : place.id)}
                    />
                  ))}
                </ul>
              )}

              <GapNotice gaps={result.gaps} />
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function bandColour(band: RankedPlace["band"]): string {
  return band === "good"
    ? "#4ade80"
    : band === "fair"
      ? "#a3e635"
      : band === "caution"
        ? "#fbbf24"
        : band === "poor"
          ? "#f87171"
          : "#6b7280";
}

function PlaceRow({ place, open, onToggle }: { place: RankedPlace; open: boolean; onToggle: () => void }) {
  return (
    <li className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-4 p-4 text-left">
        <ScoreBadge score={place.score} confidence={place.confidence} band={place.band} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{place.name}</p>
          <p className="text-xs text-[var(--color-muted)]">
            {place.kind.replace(/_/g, " ")} · {metres(place.distanceMetres)} away
            {place.openingHours === null ? " · opening hours unknown" : ` · ${place.openingHours}`}
          </p>
        </div>
        <span className="text-xs text-[var(--color-muted)]">{open ? "Hide" : "Why"}</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-[var(--color-line)] px-4 py-3">
          <DimensionList dimensions={place.dimensions} />
          <GapNotice gaps={place.gaps} />
        </div>
      ) : null}
    </li>
  );
}
