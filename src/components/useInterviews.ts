"use client";

/**
 * The interviews, from the page's point of view. Team-only: `/api/interviews`
 * answers 401 without the `/admin` session, and that is reported as
 * `signedIn: false`, never as an empty study.
 *
 * No browser fallback: a browser could never have produced a transcript, and
 * an empty list would read as a study that found nothing.
 */

import { useCallback, useEffect, useState } from "react";

import { parseInterviews, type Interview } from "@/lib/interviews";

/** `none` means no `MONGO_URI`: nowhere for interviews to live on this box. */
export type InterviewBackend = "mongo" | "none" | "unknown";

export interface InterviewStore {
  interviews: Interview[];
  backend: InterviewBackend;
  error: string | null;
  loading: boolean;
  signedIn: boolean;
  reload: () => void;
}

export function useInterviews(): InterviewStore {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [backend, setBackend] = useState<InterviewBackend>("unknown");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/interviews", { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setSignedIn(false);
          setInterviews([]);
          setError(null);
          return;
        }
        setSignedIn(true);
        if (response.status === 503) {
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
  }, [round]);

  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { interviews, backend, error, loading, signedIn, reload };
}
