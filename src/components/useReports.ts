"use client";

/**
 * Where the reports live, from the page's point of view.
 *
 * Two backends, and which one is in use is not a detail to hide:
 *
 *   * `mongo`   — `MONGO_URI` is configured; the reports (Pointer's survey,
 *                 the team's additions, community reports) are rows in the
 *                 database, asked for one city at a time.
 *   * `browser` — no database, so a community report stays in `localStorage`
 *                 here. Filed and then visible to nobody else.
 *
 * The server decides; `/api/reports` says which in every reply. A write is
 * applied locally straight away — a marker that appears half a second after
 * the click reads as a click that missed.
 */

import { useCallback, useEffect, useState } from "react";

import type { LatLng } from "@/lib/osrm";
import { addReport, loadReports, parseReports, saveReports, type Report } from "@/lib/reports";

export type Backend = "mongo" | "browser" | "unknown";

/** A provenance row, as `/api/reports` sends it. */
export interface Dataset {
  id: string;
  name: string;
  credit: string;
  rows: number;
  exportedAt?: string;
  version?: string;
  importedAt?: string;
}

export interface ReportStore {
  reports: Report[];
  datasets: Dataset[];
  backend: Backend;
  error: string | null;
  loading: boolean;
  add: (report: Report) => void;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function parseDatasets(raw: unknown): Dataset[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is Dataset =>
    !!d && typeof d === "object" && typeof (d as Dataset).id === "string" && typeof (d as Dataset).credit === "string");
}

/** Reports within `radiusM` of `centre`. */
export function useReports(centre: LatLng, radiusM: number): ReportStore {
  const [reports, setReports] = useState<Report[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [backend, setBackend] = useState<Backend>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { lat, lng } = centre;

  useEffect(() => {
    const controller = new AbortController();
    // In the IIFE like every other setState in this app: the React Compiler
    // lint rejects one reached synchronously from an effect body.
    void (async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ lat: String(lat), lng: String(lng), r: String(radiusM) });
        const response = await fetch(`/api/reports?${query}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { backend?: string; reports?: unknown; datasets?: unknown };
        if (controller.signal.aborted) return;

        if (body.backend === "mongo") {
          setBackend("mongo");
          setReports(parseReports(body.reports));
          setDatasets(parseDatasets(body.datasets));
          setError(null);
          return;
        }
        setBackend("browser");
        setReports(loadReports(browserStorage()));
        setDatasets([]);
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof Error && caught.name === "AbortError") return;
        // An empty reports map is the one thing here that reads as
        // reassurance, so a failure says so instead of drawing nothing.
        setBackend("browser");
        setReports(loadReports(browserStorage()));
        setError("Could not reach the reports database — only this browser's own reports are shown.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [lat, lng, radiusM]);

  const add = useCallback((report: Report) => {
    setReports((current) => {
      const next = [...current, report];
      saveReports(browserStorage(), addReport(loadReports(browserStorage()), report));
      return next;
    });
    void (async () => {
      try {
        const response = await fetch("/api/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report }),
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { backend?: string };
        setBackend(body.backend === "mongo" ? "mongo" : "browser");
        setError(null);
      } catch {
        setError("That report was kept in this browser — the database could not be reached.");
      }
    })();
  }, []);

  return { reports, datasets, backend, error, loading, add };
}
