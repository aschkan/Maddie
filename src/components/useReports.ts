"use client";

/**
 * Where the crime layer's reports live, from the page's point of view.
 *
 * Two backends, and which one is in use is not a detail to hide:
 *
 *   * `mongo`   — `MONGO_URI` is configured, the reports are rows in the
 *                 `maddie` database, and everyone on this instance sees them.
 *   * `browser` — no database, so they stay in `localStorage` here. Filed and
 *                 then visible to nobody else.
 *
 * The server decides; `/api/reports` says which in every reply. A report
 * somebody believed they had filed, sitting only in their own browser, is worse
 * than not being able to file one, so the panel prints the answer.
 *
 * Writes go to the server and are applied locally straight away — a marker that
 * appears half a second after the click reads as a click that missed.
 */

import { useCallback, useEffect, useState } from "react";

import {
  addReport, loadReports, parseReports, removeExamples, removeReport, saveReports, type Report,
} from "@/lib/reports";

export type Backend = "mongo" | "browser" | "unknown";

export interface ReportStore {
  reports: Report[];
  backend: Backend;
  error: string | null;
  add: (report: Report) => void;
  remove: (id: string) => void;
  clearExamples: () => void;
}

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function useReports(): ReportStore {
  const [reports, setReports] = useState<Report[]>([]);
  const [backend, setBackend] = useState<Backend>("unknown");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // In the IIFE like every other setState in this app: the React Compiler
    // lint rejects one reached synchronously from an effect body.
    void (async () => {
      try {
        const response = await fetch("/api/reports", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { backend?: string; reports?: unknown };
        if (controller.signal.aborted) return;

        if (body.backend === "mongo") {
          setBackend("mongo");
          setReports(parseReports(body.reports));
          setError(null);
          return;
        }
        // The server told us it stored nothing, so this browser is the store.
        setBackend("browser");
        setReports(loadReports(browserStorage()));
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof Error && caught.name === "AbortError") return;
        // Fall back to whatever is local rather than showing an empty layer:
        // an empty crime map is the one thing here that reads as reassurance.
        setBackend("browser");
        setReports(loadReports(browserStorage()));
        setError("Could not reach the reports database, so only this browser's own reports are shown.");
      }
    })();

    return () => controller.abort();
  }, []);

  const add = useCallback((report: Report) => {
    setReports((current) => {
      const next = addReport(current, report);
      saveReports(browserStorage(), next);
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
        // The local copy is already on the map; say that is all it is.
        setError("That report was kept in this browser — the database could not be reached.");
      }
    })();
  }, []);

  const remove = useCallback((id: string) => {
    setReports((current) => {
      const next = removeReport(current, id);
      saveReports(browserStorage(), next);
      return next;
    });
    void (async () => {
      try {
        await fetch(`/api/reports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        setError("That report is gone from this browser, but the database could not be reached.");
      }
    })();
  }, []);

  const clearExamples = useCallback(() => {
    setReports((current) => {
      const next = removeExamples(current);
      saveReports(browserStorage(), next);
      return next;
    });
    void (async () => {
      try {
        await fetch("/api/reports?examples=all", { method: "DELETE" });
      } catch {
        setError("The example reports are gone from this browser, but the database could not be reached.");
      }
    })();
  }, []);

  return { reports, backend, error, add, remove, clearExamples };
}
