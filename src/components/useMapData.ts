"use client";

/**
 * The map-side data the boards draw: nearby places, lit streets, the study
 * recording, and the police figures. Each hook keeps the rules its source
 * already had — see CLAUDE.md § "The forwarder" and § "Two crime layers".
 */

import { useEffect, useRef, useState } from "react";

import type { City } from "@/lib/cities";
import { EMPTY_LAYERS, fetchLayers, gridStep, snapBox, type BBox, type LayerData } from "@/lib/layers";
import { fetchAreas, fetchBoundaries } from "@/lib/nl-areas";
import { fetchNeighbourhoodCrime, type PlacedCrimeSummary } from "@/lib/nl-crime";
import { parseRecording, type ScenarioRecording } from "@/lib/scenario";

/** The kinds of place the boards count as "nearby places". */
/**
 * Not bars and restaurants: a city centre has hundreds, and a heart every few
 * metres says nothing about one route against another. These are the places a
 * person would walk TOWARDS — staffed, lit, usually open late.
 */
export const PLACE_KINDS = ["police", "hospital", "transit", "supermarket", "pharmacy", "taxi", "fuel", "library", "gym24"];

/** The box around every district of a city, padded a little. */
export function cityBox(city: City): BBox {
  const points = city.districts.flatMap((district) => district.outline);
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  return {
    south: Math.min(...lats) - 0.002, north: Math.max(...lats) + 0.002,
    west: Math.min(...lngs) - 0.003, east: Math.max(...lngs) + 0.003,
  };
}

/**
 * The recorded Utrecht scenario, loaded only when asked for — a megabyte and a
 * half nobody else should pay for. See `scenario.ts`.
 */
export function useRecording(wanted: boolean): { recording: ScenarioRecording | null; error: string | null } {
  const [recording, setRecording] = useState<ScenarioRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || recording) return;
    let gone = false;
    void (async () => {
      try {
        const loaded = await import("@/lib/scenario-recording.json");
        if (gone) return;
        const parsed = parseRecording(loaded.default);
        setRecording(parsed);
        setError(parsed ? null : "The scenario recording is empty. Run `npm run scenario`.");
      } catch {
        if (!gone) setError("The scenario recording could not be loaded.");
      }
    })();
    return () => { gone = true; };
  }, [wanted, recording]);
  return { recording, error };
}

/**
 * Places and lit streets inside a box, live from Overpass.
 *
 * The box is SNAPPED onto the grid before asking (CLAUDE.md § "The layer bbox
 * is SNAPPED"), and the same question is never asked twice in a row.
 */
export function useLiveLayers(box: BBox | null, kinds: string[], lighting: boolean): { layers: LayerData; error: string | null; busy: boolean } {
  const [layers, setLayers] = useState<LayerData>(EMPTY_LAYERS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef<string | null>(null);
  const kindKey = [...kinds].sort().join(",");
  const snapped = box ? snapBox(box, gridStep(box)) : null;
  const key = snapped ? `${snapped.south},${snapped.west},${snapped.north},${snapped.east}|${kindKey}|${lighting}` : null;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        if (!key || !snapped || (kindKey === "" && !lighting)) {
          setLayers(EMPTY_LAYERS);
          setError(null);
          asked.current = null;
          return;
        }
        if (asked.current === key) return;
        setBusy(true);
        const result = await fetchLayers(snapped, kindKey ? kindKey.split(",") : [], lighting, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setBusy(false);
        if (result.ok) {
          asked.current = key;
          setLayers(result.data);
          setError(null);
        } else if (result.error !== "cancelled") {
          setError(result.error);
        }
      })();
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `snapped` is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, kindKey, lighting]);

  return { layers, error, busy };
}

/**
 * The CBS police figures over a box: PDOK finds the neighbourhoods, CBS gives
 * their monthly counts, the WFS gives their outlines. Never scored, never
 * merged with the reports — CLAUDE.md § "Two crime layers".
 */
export function usePoliceFigures(enabled: boolean, box: BBox | null): {
  areas: PlacedCrimeSummary[]; periods: string[]; error: string | null; busy: boolean;
} {
  const [areas, setAreas] = useState<PlacedCrimeSummary[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef<string | null>(null);
  const snapped = box ? snapBox(box, gridStep(box)) : null;
  const key = snapped ? `${snapped.south},${snapped.west},${snapped.north},${snapped.east}` : null;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        if (!enabled || !snapped || !key) {
          setAreas([]);
          setError(null);
          asked.current = null;
          return;
        }
        if (asked.current === key) return;
        setBusy(true);
        try {
          const found = await fetchAreas(snapped, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!found.ok) {
            if (found.error !== "cancelled") setError(found.error);
            return;
          }
          if (found.areas.length === 0) {
            asked.current = key;
            setAreas([]);
            setError("No Dutch neighbourhood here — CBS publishes these figures for the Netherlands only.");
            return;
          }
          const figures = await fetchNeighbourhoodCrime(
            found.areas.map((area) => ({ code: area.code, name: area.name })),
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          if (!figures.ok) {
            if (figures.error !== "cancelled") setError(figures.error);
            return;
          }
          const where = new Map(found.areas.map((area) => [area.code, area.point]));
          const outlines = await fetchBoundaries(figures.data.summaries.map((summary) => summary.areaCode), { signal: controller.signal });
          if (controller.signal.aborted) return;
          const shapes = new Map(outlines.map((one) => [one.code, one.rings]));
          asked.current = key;
          setAreas(figures.data.summaries.map((summary) => ({
            ...summary,
            point: where.get(summary.areaCode) ?? { lat: 0, lng: 0 },
            ...(shapes.get(summary.areaCode) ? { rings: shapes.get(summary.areaCode) } : {}),
          })));
          setPeriods(figures.data.periods);
          setError(null);
        } finally {
          if (!controller.signal.aborted) setBusy(false);
        }
      })();
    }, 800);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return { areas, periods, error, busy };
}
