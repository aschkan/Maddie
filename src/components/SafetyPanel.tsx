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
 *
 * The strip below the verdict is the same route the map is drawing, in the same
 * colours: one block per 400 m stretch. A single number over a 4 km walk is an
 * average of a lit high street and an unlit park path, and the average is the
 * part you cannot act on — see `segments.ts`.
 */

import { useEffect, useState } from "react";

import type { Light } from "@/lib/daylight";
import { formatDistance } from "@/lib/format";
import type { RouteFacts } from "@/lib/overpass";
import type { Assessment, When } from "@/lib/score";
import type { Segment } from "@/lib/segments";
import { VERDICT_COLOUR, VERDICT_LABEL } from "@/lib/verdict";

type Result = Assessment & { narration: string | null; narratedBy: "local" | "liara" | null };

/* A class rather than a hex, so the two themes can each pick a colour that is
   actually readable against their own background. */
const VERDICT_CLASS: Record<Assessment["verdict"], string> = {
  good: "v-good",
  fair: "v-fair",
  poor: "v-poor",
  unknown: "v-unknown",
};

const LIGHT_WORD: Record<Light, string> = {
  day: "daylight",
  twilight: "dusk",
  night: "after dark",
};

interface Props {
  facts: RouteFacts | null;
  /** When and where — the sun's position is worked out from it. */
  when: When;
  /** The route in stretches. Empty until it has been read. */
  segments: Segment[];
  /** The sentence naming the worst stretch, or null when none stands out. */
  worstLine: string | null;
}

export default function SafetyPanel({ facts, when, segments, worstLine }: Props) {
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
          // The point and the instant go with the hour so the server can work
          // out where the sun actually is. Without them it falls back to the
          // clock rule and says so — see `lightingFor`.
          body: JSON.stringify({
            facts,
            hour: when.hour,
            point: when.point ?? null,
            at: when.at?.toISOString() ?? null,
          }),
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
  }, [facts, when]);

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

      {/* One block per stretch, in route order. Decorative on its own — the
          sentence under it is what carries the meaning to a screen reader. */}
      {segments.length > 1 && (
        <>
          <div className="strip" aria-hidden="true">
            {segments.map((segment) => (
              <span
                key={segment.fromM}
                className="strip-part"
                /* Length-weighted, so the bar is the route rather than a row of
                   equal ticks. A one-sample stretch would otherwise be zero
                   wide and vanish. */
                style={{
                  flexGrow: Math.max(1, segment.toM - segment.fromM),
                  backgroundColor: VERDICT_COLOUR[segment.verdict],
                }}
                title={`${formatDistance(segment.fromM)}–${formatDistance(segment.toM)}: ${
                  segment.score === null
                    ? VERDICT_LABEL.unknown
                    : `${VERDICT_LABEL[segment.verdict]} · ${segment.score}/100`
                }`}
              />
            ))}
          </div>
          <p className="strip-caption">
            A → B in {formatDistance(segments[0] ? segments[0].toM - segments[0].fromM : 0)} stretches.
            Grey is map data missing, not a dark street.
          </p>
        </>
      )}

      {worstLine && <p className="worst">{worstLine}</p>}

      {result.narration && <p className="narration">{result.narration}</p>}

      <ul className="findings">
        {result.findings.map((line) => <li key={line}>{line}</li>)}
      </ul>

      <p className="coords">
        confidence {Math.round(result.confidence * 100)}%
        {` · ${facts.samples} points sampled`}
        {/* Where the "dark" came from. A null elevation means the sun was never
            worked out and the hour alone stood in, which is a weaker claim and
            has to read as one. */}
        {` · ${LIGHT_WORD[result.light]}${result.sunDeg === null ? " (by the clock)" : ""}`}
        {result.narratedBy ? ` · explained by ${result.narratedBy} model` : " · no model available"}
      </p>
    </div>
  );
}
