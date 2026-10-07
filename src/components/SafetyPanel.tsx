"use client";

/**
 * The Safety tab: WHY this route — the recommendation, explained.
 *
 * The supervisor's split of the tabs, which this panel exists to keep: "first
 * page I show you all your possibilities and my recommendation; second page
 * I'm telling you why I recommended this — but you don't get to affect
 * anything there." Changing what counts is the Layers tab. This one explains.
 *
 * In order, from the answer down to how it was reached:
 *
 *   1. The recommendation sentence, and the selected route's reading.
 *   2. The route stretch by stretch — the strip, in the map's own colours.
 *   3. A table of every factor, every route, side by side. This is the
 *      explanation: "Route 2 is preferred" becomes "Route 2 is lit for 80% of
 *      its length against 35%, and has twelve shops along it against two".
 *      Factors switched off in Layers are shown struck through, so it is
 *      visible that they were left out rather than silently missing.
 *   4. Below a rule, what is BESIDE the score — reports and places to go near
 *      each route. Counted, compared, and labelled as not part of the number.
 *   5. How it is computed, on demand.
 *
 * Code computes the score; the model only writes the paragraph. If no model
 * answers, everything here except that paragraph is still shown.
 */

import { useEffect, useState } from "react";

import type { Alongside } from "@/components/RouteChoices";
import type { Comparison } from "@/lib/compare";
import type { Light } from "@/lib/daylight";
import { formatDistance } from "@/lib/format";
import type { RouteFacts } from "@/lib/overpass";
import type { Route } from "@/lib/osrm";
import { pick, ROUTE, type Tone } from "@/lib/palette";
import { allOn, FACTORS, type Assessment, type Factor, type Factors, type When } from "@/lib/score";
import type { Segment } from "@/lib/segments";
import { FAIR_FROM, GOOD_FROM, VERDICT_CLASS, VERDICT_EXPLAIN, VERDICT_LABEL } from "@/lib/verdict";

type Result = Assessment & { narration: string | null; narratedBy: "liara" | null };

const LIGHT_WORD: Record<Light, string> = {
  day: "daylight",
  twilight: "dusk",
  night: "after dark",
};

interface Props {
  /** The selected route's counts. */
  facts: RouteFacts | null;
  /** When and where — the sun's position is worked out from it. */
  when: When;
  /** The selected route in stretches. Empty until it has been read. */
  segments: Segment[];
  /** The sentence naming the stretch worth a closer look, or null. */
  worstLine: string | null;
  factors: Factors;
  tone: Tone;
  routes: Route[];
  allFacts: (RouteFacts | null)[];
  assessments: (Assessment | null)[];
  comparison: Comparison;
  selected: number;
  onSelect: (index: number) => void;
  alongside: Alongside[];
  showReports: boolean;
  showPlaces: boolean;
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

/** One row per factor: what that factor IS for this route, in its own units. */
function factorValue(id: Factor, facts: RouteFacts): string {
  const km = Math.max(0.1, facts.lengthM / 1000);
  switch (id) {
    case "lighting":
      return `${pct(facts.litSamples, facts.samples)} lit · ${pct(facts.unlitSamples, facts.samples)} unlit`;
    case "lamps":
      return `${Math.round(facts.lamps / km)} per km`;
    case "frontage":
      return `${facts.venues} shops & cafés`;
    case "parkland":
      return `${pct(facts.greenSamples, facts.samples)} of the way`;
    case "tunnels":
      return facts.tunnels === 0 ? "none" : String(facts.tunnels);
  }
}

export default function SafetyPanel({
  facts, when, segments, worstLine, factors, tone, routes, allFacts, assessments, comparison,
  selected, onSelect, alongside, showReports, showPlaces,
}: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [stage, setStage] = useState<"idle" | "words" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [how, setHow] = useState(false);

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
          // out where the sun actually is; the factors go too, so the sentence
          // explains the number on this screen and not a different one.
          body: JSON.stringify({
            facts,
            hour: when.hour,
            point: when.point ?? null,
            at: when.at?.toISOString() ?? null,
            factors,
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
            : "Could not reach the assessment service — the reading below is complete, only the written explanation is missing.",
        );
      }
    })();

    return () => controller.abort();
  }, [facts, when, factors]);

  if (!facts) return null;

  // The panel's own reading is the page's, computed locally — the server's
  // copy is only for the paragraph. They agree by construction (same function,
  // same inputs), and this way the panel never waits on a network to say it.
  const local = assessments[selected] ?? null;

  return (
    <div className="safety">
      <header className="panel-head">
        <h2>Why this route</h2>
        <p className="hint">What the map records along each way round, and how that turned into a suggestion.</p>
      </header>

      <p className={comparison.preferred === null ? "recommend none" : "recommend"}>
        {comparison.preferred === null
          ? <><strong>No route is starred.</strong> {comparison.reason}</>
          : comparison.preferred === selected
            ? <><strong>★ Route {selected + 1} is preferred.</strong> {comparison.reason}</>
            : <>You are looking at <strong>Route {selected + 1}</strong>. <strong>Route {comparison.preferred + 1}</strong> is
               preferred — {comparison.reason.charAt(0).toLowerCase() + comparison.reason.slice(1)}</>}
      </p>

      {local && (
        <div className={`verdict ${VERDICT_CLASS[local.verdict]}`}>
          <span className="v-label">{VERDICT_LABEL[local.verdict]}</span>
          {local.score !== null && <span className="v-score">{local.score}<small>/100</small></span>}
          <span className="v-explain">{VERDICT_EXPLAIN[local.verdict]}</span>
        </div>
      )}

      {/* One block per stretch, in route order, in the map's own colours.
          Decorative on its own — the sentence under it carries the meaning. */}
      {segments.length > 1 && (
        <>
          <div className="strip" aria-hidden="true">
            {segments.map((segment) => (
              <span
                key={segment.fromM}
                className={segment.verdict === "unknown" ? "strip-part is-unknown" : "strip-part"}
                /* Length-weighted, so the bar is the route rather than a row of
                   equal ticks. */
                style={{
                  flexGrow: Math.max(1, segment.toM - segment.fromM),
                  backgroundColor: pick(ROUTE[segment.verdict], tone),
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
            A → B, in stretches of about {formatDistance(segments[0] ? segments[0].toM - segments[0].fromM : 0)}.
            Grey hatching is missing map data, not a dark street.
          </p>
        </>
      )}

      {worstLine && <p className="worst">{worstLine}</p>}

      {stage === "words" && <p className="hint">Writing the explanation…</p>}
      {result?.narration && <p className="narration">{result.narration}</p>}
      {error && <p className="hint">{error}</p>}

      {/* ── the comparison ──────────────────────────────────────────────── */}
      {routes.length > 0 && (
        <div className="compare">
          <h3>What went into it</h3>
          <div className="compare-scroll">
            <table className="compare-table">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Factor</span></th>
                  {routes.map((_, index) => (
                    <th key={index} scope="col" className={index === selected ? "is-selected" : ""}>
                      <button type="button" className="th-button" onClick={() => onSelect(index)}>
                        {comparison.preferred === index ? "★ " : ""}Route {index + 1}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="row-score">
                  <th scope="row">Reading</th>
                  {routes.map((_, index) => {
                    const one = assessments[index];
                    return (
                      <td key={index} className={index === selected ? "is-selected" : ""}>
                        {one ? (
                          <span className={`chip ${VERDICT_CLASS[one.verdict]}`}>
                            {one.score === null ? "no data" : `${one.score}`}
                          </span>
                        ) : "…"}
                      </td>
                    );
                  })}
                </tr>
                {FACTORS.map((factor) => (
                  <tr key={factor.id} className={factors[factor.id] ? "" : "is-off"}>
                    <th scope="row">
                      {factor.label}
                      {!factors[factor.id] && <small>not counted</small>}
                    </th>
                    {routes.map((_, index) => {
                      const one = allFacts[index];
                      return (
                        <td key={index} className={index === selected ? "is-selected" : ""}>
                          {one ? factorValue(factor.id, one) : "…"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="row-rule"><th scope="row" colSpan={routes.length + 1}>Beside the reading — not part of it</th></tr>
                <tr>
                  <th scope="row">Reports nearby</th>
                  {routes.map((_, index) => (
                    <td key={index} className={index === selected ? "is-selected" : ""}>
                      {showReports ? (alongside[index]?.reports ?? "–") : "hidden"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Places to go</th>
                  {routes.map((_, index) => (
                    <td key={index} className={index === selected ? "is-selected" : ""}>
                      {showPlaces ? (alongside[index]?.places ?? "–") : "hidden"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          {!allOn(factors) && (
            <p className="hint">Some factors are switched off in <strong>Layers</strong>, so these routes are compared without them.</p>
          )}
        </div>
      )}

      {/* ── how it is computed — on demand ───────────────────────────────── */}
      <button type="button" className="disclose" aria-expanded={how} onClick={() => setHow(!how)}>
        <span className="lg-info" aria-hidden="true">i</span> How the reading is worked out
      </button>
      {how && (
        <div className="how">
          <p>Every route is sampled every 25 m and each point is matched to the street it stands on in
            OpenStreetMap. The counts — lit, unlit and untagged streets, lamps, shops and cafés, parkland, tunnels —
            are turned into a score out of 100 by one fixed formula, the same for every route and every stretch.</p>
          <p>The hour matters: after dark, lighting is most of the score and parkland counts against a route; by
            day lighting barely counts. The sun&rsquo;s position is computed for the place and the date, not guessed
            from the clock.</p>
          <p>{GOOD_FROM}+ is <em>{VERDICT_LABEL.good}</em>, {FAIR_FROM}–{GOOD_FROM - 1} is <em>{VERDICT_LABEL.fair}</em>,
            under {FAIR_FROM} is <em>{VERDICT_LABEL.poor}</em>. A route is only starred when it reads at least 6 points
            better than the next one — closer than that and the difference is within the noise of the sampling.</p>
          <p>Reports and police figures are <strong>never</strong> part of the score. Reports are what people chose to
            enter, and a gap in them would read as reassurance; police figures cover a whole neighbourhood and would
            give every route through it the same number. Both are shown beside the score, so you can weigh them.</p>
          <ul className="findings">
            {(result ?? local)?.findings.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}

      <p className="coords">
        {local && <>confidence {Math.round(local.confidence * 100)}% · </>}
        {facts.samples} points sampled
        {/* Where the "dark" came from. A null elevation means the sun was never
            worked out and the hour alone stood in, which is a weaker claim and
            has to read as one. */}
        {local && ` · ${LIGHT_WORD[local.light]}${local.sunDeg === null ? " (by the clock)" : ""}`}
        {result ? (result.narratedBy ? ` · explained by ${result.narratedBy} model` : " · no model available") : ""}
      </p>
    </div>
  );
}
