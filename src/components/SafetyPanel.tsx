"use client";

/**
 * The safety read for the current route.
 *
 * Two steps, and they are kept visibly apart because they fail differently:
 * the browser asks OpenStreetMap what the streets are like, then the server
 * asks the model to put the resulting numbers into words. If the model is
 * unavailable you still get the score and the findings — the sentence is the
 * only thing lost.
 */

import { useEffect, useState } from "react";

import { fetchFacts, type RouteFacts } from "@/lib/overpass";
import type { Assessment } from "@/lib/score";
import type { Route } from "@/lib/osrm";

type Result = Assessment & { narration: string | null; narratedBy: "local" | "liara" | null };

const VERDICT_LABEL: Record<Assessment["verdict"], string> = {
  good: "Looks fine",
  fair: "Mixed",
  poor: "Take care",
  unknown: "Not enough map data",
};

const VERDICT_COLOUR: Record<Assessment["verdict"], string> = {
  good: "#6ee7a8",
  fair: "#e0c04c",
  poor: "#ef8f5b",
  unknown: "#7c8798",
};

export default function SafetyPanel({ route, hour }: { route: Route | null; hour: number }) {
  const [result, setResult] = useState<Result | null>(null);
  const [facts, setFacts] = useState<RouteFacts | null>(null);
  const [stage, setStage] = useState<"idle" | "map" | "words" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // Every setState is inside this: the React Compiler lint rejects one
    // reached synchronously from an effect body.
    void (async () => {
      if (!route) {
        setResult(null);
        setFacts(null);
        setError(null);
        setStage("idle");
        return;
      }

      setResult(null);
      setError(null);
      setStage("map");

      const found = await fetchFacts(route.path, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!found.ok) {
        setStage("idle");
        setError(found.error === "cancelled" ? null : found.error);
        return;
      }
      setFacts(found.facts);
      setStage("words");

      try {
        const response = await fetch("/api/assess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facts: found.facts, hour }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(`assess ${response.status}`);
        setResult((await response.json()) as Result);
        setStage("done");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setStage("idle");
        setError(
          caught instanceof Error && caught.name === "AbortError"
            ? null
            : "Could not reach the assessment service.",
        );
      }
    })();

    return () => controller.abort();
  }, [route, hour]);

  if (!route) return null;

  if (stage === "map" || stage === "words") {
    return (
      <p className="hint">
        {stage === "map" ? "Reading the streets from OpenStreetMap…" : "Working out what that means…"}
      </p>
    );
  }

  if (error) return <p className="error">{error}</p>;
  if (!result) return null;

  return (
    <div className="safety">
      <div className="verdict" style={{ borderColor: VERDICT_COLOUR[result.verdict] }}>
        <span className="v-label" style={{ color: VERDICT_COLOUR[result.verdict] }}>
          {VERDICT_LABEL[result.verdict]}
        </span>
        {result.score !== null && <span className="v-score">{result.score}<small>/100</small></span>}
      </div>

      {result.narration && <p className="narration">{result.narration}</p>}

      <ul className="findings">
        {result.findings.map((line) => <li key={line}>{line}</li>)}
      </ul>

      <p className="coords">
        confidence {Math.round(result.confidence * 100)}%
        {facts ? ` · ${facts.samples} points sampled` : ""}
        {result.narratedBy ? ` · explained by ${result.narratedBy} model` : " · no model available"}
      </p>
    </div>
  );
}
