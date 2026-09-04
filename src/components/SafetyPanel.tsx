"use client";

/**
 * The safety read for the SELECTED route.
 *
 * The counts arrive as a prop: every candidate route was already read from
 * OpenStreetMap by `useRouteFacts`, and asking again here would double the
 * Overpass traffic for an answer already on the page.
 *
 * What is left is the sentence. Code computes the score, the model explains
 * it — and the two steps stay visibly apart because they fail differently. If
 * no model answers you still get the score and the findings; only the prose
 * is lost.
 */

import { useEffect, useState } from "react";

import type { RouteFacts } from "@/lib/overpass";
import type { Assessment } from "@/lib/score";

type Result = Assessment & { narration: string | null; narratedBy: "local" | "liara" | null };

const VERDICT_LABEL: Record<Assessment["verdict"], string> = {
  good: "Looks fine",
  fair: "Mixed",
  poor: "Take care",
  unknown: "Not enough map data",
};

/* A class rather than a hex, so the two themes can each pick a colour that is
   actually readable against their own background. */
const VERDICT_CLASS: Record<Assessment["verdict"], string> = {
  good: "v-good",
  fair: "v-fair",
  poor: "v-poor",
  unknown: "v-unknown",
};

export default function SafetyPanel({ facts, hour }: { facts: RouteFacts | null; hour: number }) {
  const [result, setResult] = useState<Result | null>(null);
  const [stage, setStage] = useState<"idle" | "words" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    // Every setState is inside this: the React Compiler lint rejects one
    // reached synchronously from an effect body.
    void (async () => {
      if (!facts) {
        setResult(null);
        setError(null);
        setStage("idle");
        return;
      }

      setResult(null);
      setError(null);
      setStage("words");

      try {
        const response = await fetch("/api/assess", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facts, hour }),
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
  }, [facts, hour]);

  if (!facts) return null;

  if (stage === "words") {
    return <p className="hint">Working out what that means…</p>;
  }

  if (error) return <p className="error">{error}</p>;
  if (!result) return null;

  return (
    <div className="safety">
      <div className={`verdict ${VERDICT_CLASS[result.verdict]}`}>
        <span className="v-label">{VERDICT_LABEL[result.verdict]}</span>
        {result.score !== null && <span className="v-score">{result.score}<small>/100</small></span>}
      </div>

      {result.narration && <p className="narration">{result.narration}</p>}

      <ul className="findings">
        {result.findings.map((line) => <li key={line}>{line}</li>)}
      </ul>

      <p className="coords">
        confidence {Math.round(result.confidence * 100)}%
        {` · ${facts.samples} points sampled`}
        {result.narratedBy ? ` · explained by ${result.narratedBy} model` : " · no model available"}
      </p>
    </div>
  );
}
