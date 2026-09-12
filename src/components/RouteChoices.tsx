"use client";

/**
 * Comparing the ways round.
 *
 * The badge says **Preferred**, never "Safe". What the map supports is "this
 * one is better lit and has more open frontage than that one", which is a much
 * smaller claim than safety, and the word has to match the claim — see
 * `compare.ts`, which also refuses to badge anything when the routes score too
 * close together to tell apart.
 */

import type { Route } from "@/lib/osrm";
import type { Assessment } from "@/lib/score";
import type { Comparison } from "@/lib/compare";
import { formatDistance, formatDuration } from "@/lib/format";
import { VERDICT_LABEL } from "@/lib/verdict";

interface Props {
  routes: Route[];
  assessments: (Assessment | null)[];
  comparison: Comparison;
  selected: number;
  onSelect: (index: number) => void;
  /** How many routes have been read so far. */
  done: number;
}

export default function RouteChoices({
  routes, assessments, comparison, selected, onSelect, done,
}: Props) {
  if (routes.length === 0) return null;

  return (
    <div className="choices">
      <h2>
        {routes.length === 1 ? "One route" : `${routes.length} ways round`}
        {done < routes.length && <small> · reading {done + 1} of {routes.length}…</small>}
      </h2>

      <ul>
        {routes.map((route, index) => {
          const assessment = assessments[index];
          const preferred = comparison.preferred === index;
          return (
            <li key={`${route.metres}-${index}`}>
              <button
                type="button"
                className={index === selected ? "choice on" : "choice"}
                onClick={() => onSelect(index)}
                aria-pressed={index === selected}
              >
                <span className="choice-head">
                  <span className="choice-name">Route {index + 1}</span>
                  {preferred && <span className="tag preferred">Preferred</span>}
                  {comparison.fastest === index && routes.length > 1 && (
                    <span className="tag fastest">Fastest</span>
                  )}
                </span>
                <span className="choice-figures">
                  {formatDistance(route.metres)} · {formatDuration(route.seconds)}
                </span>
                <span className="choice-verdict">
                  {assessment === null || assessment === undefined
                    ? "reading the streets…"
                    : assessment.score === null
                      ? VERDICT_LABEL.unknown
                      : `${VERDICT_LABEL[assessment.verdict]} · ${assessment.score}/100`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {comparison.reason && done >= routes.length && (
        <p className="hint">{comparison.reason}</p>
      )}
    </div>
  );
}
