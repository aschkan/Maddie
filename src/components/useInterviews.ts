"use client";

/**
 * The requirements interviews, from the page's point of view.
 *
 * Read-only, and much simpler than `useReports` for one reason: there is no
 * browser fallback. A report is something a visitor can type, so `localStorage`
 * is a real second home for it; an interview is a transcript of a sitting that
 * happened in a room with a consent form signed first, so a browser has no
 * business holding one and could never have produced one. No database means no
 * interviews, and the panel says exactly that rather than rendering an empty
 * list — an empty cohort reads as a study that found nothing.
 */

import { useEffect, useState } from "react";

import { parseInterviews, type Interview } from "@/lib/interviews";

/** `none` means no `MONGO_URI`: nowhere for interviews to live on this box. */
export type InterviewBackend = "mongo" | "none" | "unknown";

export interface InterviewStore {
  interviews: Interview[];
  backend: InterviewBackend;
  error: string | null;
  loading: boolean;
}

export function useInterviews(): InterviewStore {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [backend, setBackend] = useState<InterviewBackend>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    // In the IIFE like every other setState in this app: the React Compiler
    // lint rejects one reached synchronously from an effect body.
    void (async () => {
      try {
        const response = await fetch("/api/interviews", { signal: controller.signal });
        if (controller.signal.aborted) return;

        if (response.status === 503) {
          // Configured but unreachable. Said as an error, never as an empty
          // cohort — the same rule the reports route keeps, and it matters
          // more here because zero participants looks like a finding.
          setBackend("mongo");
          setError("The interview database is configured but could not be reached.");
          return;
        }
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as { backend?: string; interviews?: unknown };
        if (controller.signal.aborted) return;
        setBackend(body.backend === "mongo" ? "mongo" : "none");
        setInterviews(parseInterviews(body.interviews));
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError("Could not reach this server to ask for the interviews.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  return { interviews, backend, error, loading };
}
