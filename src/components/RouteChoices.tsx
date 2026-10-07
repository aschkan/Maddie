"use client";

/**
 * The ways round — and which one we suggest.
 *
 * The supervisor's note on the first prototype: "I kind of feel that I am
 * clicking on routes; you're not recommending me something." So the
 * recommendation is the first thing in the list and it looks like one: its own
 * card, a star, the reason in a sentence, and the same "★ Preferred" pill the
 * map puts on the line itself. The other routes follow as plainer cards, each
 * saying how it differs — time, how it reads, what is beside it.
 *
 * The badge says **Preferred**, never "Safe". What the map supports is "this
 * one is better lit and has more open frontage than that one", which is a much
 * smaller claim than safety, and the word has to match the claim — see
 * `compare.ts`, which also refuses to star anything when the routes score too
 * close together to tell apart. When nothing is starred, the card says so,
 * because "no recommendation" is an answer too.
 */

import type { Route } from "@/lib/osrm";
import type { Assessment } from "@/lib/score";
import type { Comparison } from "@/lib/compare";
import { formatDistance, formatDuration } from "@/lib/format";
import { VERDICT_CLASS, VERDICT_LABEL } from "@/lib/verdict";

export interface Alongside {
  reports: number;
  places: number;
}

interface Props {
  routes: Route[];
  assessments: (Assessment | null)[];
  comparison: Comparison;
  selected: number;
  onSelect: (index: number) => void;
  /** How many routes have been read so far. */
  done: number;
  /** Reports and places near each route — beside the score, never in it. */
  alongside: Alongside[];
  /** Whether those two layers are on, so a hidden layer does not read as zero. */
  showReports: boolean;
  showPlaces: boolean;
}

/** "+4 min" against the fastest — the cost of the suggestion, said plainly. */
function slower(route: Route, fastest: Route | undefined): string | null {
  if (!fastest || fastest === route) return null;
  const minutes = Math.round((route.seconds - fastest.seconds) / 60);
  return minutes > 0 ? `+${minutes} min` : null;
}

export default function RouteChoices({
  routes, assessments, comparison, selected, onSelect, done, alongside, showReports, showPlaces,
}: Props) {
  if (routes.length === 0) return null;
  const fastest = comparison.fastest === null ? undefined : routes[comparison.fastest];
  const finished = done >= routes.length;

  // The suggestion first; then the rest in the order they were offered.
  const order = routes.map((_, index) => index);
  if (comparison.preferred !== null) {
    order.splice(order.indexOf(comparison.preferred), 1);
    order.unshift(comparison.preferred);
  }

  return (
    <div className="group choices">
      <h2>
        {routes.length === 1 ? "One way round" : `${routes.length} ways round`}
        {!finished && <small> · reading {done + 1} of {routes.length}…</small>}
      </h2>

      {finished && comparison.preferred === null && routes.length > 1 && (
        <p className="no-pick">
          <strong>No route is starred.</strong> {comparison.reason}
        </p>
      )}

      <ul>
        {order.map((index) => {
          const route = routes[index];
          if (!route) return null;
          const assessment = assessments[index];
          const preferred = comparison.preferred === index;
          const near = alongside[index];
          const extra = slower(route, fastest);
          return (
            <li key={`${route.metres}-${index}`}>
              <button
                type="button"
                className={`choice${index === selected ? " on" : ""}${preferred ? " preferred" : ""}`}
                onClick={() => onSelect(index)}
                aria-pressed={index === selected}
              >
                {preferred && <span className="choice-ribbon">★ Preferred</span>}
                <span className="choice-head">
                  <span className="choice-name">Route {index + 1}</span>
                  {comparison.fastest === index && routes.length > 1 && (
                    <span className="tag fastest">Fastest</span>
                  )}
                </span>
                <span className="choice-figures">
                  {formatDuration(route.seconds)}
                  {extra && <small> {extra}</small>}
                  <small> · {formatDistance(route.metres)}</small>
                </span>
                <span className="choice-verdict">
                  {assessment === null || assessment === undefined ? (
                    <span className="chip v-unknown">reading the streets…</span>
                  ) : (
                    <span className={`chip ${VERDICT_CLASS[assessment.verdict]}`}>
                      {assessment.score === null
                        ? VERDICT_LABEL.unknown
                        : `${VERDICT_LABEL[assessment.verdict]} · ${assessment.score}/100`}
                    </span>
                  )}
                </span>
                {near && (showReports || showPlaces) && (
                  <span className="choice-beside">
                    {showReports && <span className="beside-report">{near.reports} report{near.reports === 1 ? "" : "s"}</span>}
                    {showPlaces && <span className="beside-place">{near.places} place{near.places === 1 ? "" : "s"} to go</span>}
                    <small>along the way</small>
                  </span>
                )}
              </button>
              {preferred && finished && <p className="choice-why">{comparison.reason}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
