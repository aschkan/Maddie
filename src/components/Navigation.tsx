"use client";

/**
 * The navigation view: the banner at the top and the bar at the bottom.
 *
 * Everything else on the page gets out of the way when this appears — the trip
 * card, the sheet, the tabs. That is the point of a navigation mode and not a
 * cosmetic one: the person reading this is walking, probably at night, holding
 * the phone in one hand, and the three things worth any screen are what to do
 * next, how far is left, and how to stop.
 *
 * The arithmetic is all in `src/lib/navigation.ts`, pure and tested. This file
 * is only how it is arranged.
 *
 * **What Maddie adds to a navigation view, and why it is here rather than in
 * the panel:** the stretch you are walking through right now has a safety read
 * of its own, and the whole app exists to say so. A verdict buried in a tab you
 * cannot open while walking is a verdict nobody sees. So when the current
 * stretch is the one worth mentioning, it appears in this view — once, quietly,
 * and never as an alarm.
 */

import { formatDistance, formatDuration } from "@/lib/format";
import { asClause, distanceCue, instructionFor, maneuverGlyph, type Progress } from "@/lib/navigation";
import type { Segment } from "@/lib/segments";
import { VERDICT_CLASS, VERDICT_LABEL } from "@/lib/verdict";

export interface NavigationProps {
  progress: Progress | null;
  /** The stretch the walker is standing in, if the map says anything about it. */
  here: Segment | null;
  /** True while the map is glued to the walker. */
  following: boolean;
  onRecentre: () => void;
  onExit: () => void;
  /** Why there is no position, when there is none. */
  locationError: string | null;
  /** True after asking for a position and before the first one arrives. */
  waiting: boolean;
}

/** The clock time of arrival, in the viewer's own timezone and format. */
function clockAt(seconds: number): string {
  const at = new Date(Date.now() + Math.max(0, seconds) * 1000);
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Navigation({
  progress, here, following, onRecentre, onExit, locationError, waiting,
}: NavigationProps) {
  const next = progress?.next?.step ?? null;
  const after = progress?.after?.step ?? null;
  const arrived = progress?.arrived === true;

  /*
   * The stretch worth mentioning is a POOR one, and only a poor one.
   *
   * Not `unknown`: "nobody has mapped this street" is true of most streets in
   * most of the world and is not a thing to tell someone every four hundred
   * metres while they walk. Not `fair` either — a caution that appears
   * constantly is one that stops being read, which is the failure that matters
   * on the night it is right.
   */
  const caution = here && here.verdict === "poor" ? here : null;

  return (
    <>
      {/* ── what to do next ────────────────────────────────────────────────
          ONE card, the same one the trip card and the verdict cards are: a
          panel, a hairline, the app's radius and shadow. The instruction and
          the one after it are two rows of it rather than two floating shapes,
          because they are one thought — and because a pill hanging off the
          corner of a green slab is somebody else's product, not this one. */}
      <div className="nav-top">
        <div className="nav-card" aria-live="polite">
          <div className="nav-row">
            <span className="nav-glyph" aria-hidden="true">
              {arrived ? "◎" : maneuverGlyph(next)}
            </span>
            <span className="nav-say">
              <strong>{arrived ? "You have arrived" : instructionFor(next)}</strong>
              {!arrived && progress?.toNextM !== null && progress?.toNextM !== undefined && (
                <small>{distanceCue(progress.toNextM)}</small>
              )}
            </span>
          </div>

          {!arrived && after && (
            <p className="nav-then">
              <span className="nav-then-label">Then</span>
              <span className="nav-then-glyph" aria-hidden="true">{maneuverGlyph(after)}</span>
              {asClause(instructionFor(after))}
            </p>
          )}
        </div>

        {/* One line, and only when it is the kind of stretch worth naming. The
            verdict's own colour down the left edge — the same way every other
            verdict on this page is shown. */}
        {caution && !arrived && (
          <p className={`nav-note ${VERDICT_CLASS[caution.verdict]}`}>
            <strong>{VERDICT_LABEL[caution.verdict]}</strong> along here
            {caution.streets[0] ? ` — ${caution.streets[0]}` : ""}
          </p>
        )}

        {progress?.offRoute && !arrived && (
          <p className="nav-note nav-off">
            You are off the planned route. Head back to the line, or exit and plan again from here.
          </p>
        )}

        {waiting && !progress && <p className="nav-note">Waiting for a position…</p>}
        {locationError && <p className="nav-note nav-off">{locationError}</p>}
      </div>

      {/* ── how far, and how to stop ───────────────────────────────────────
          A floating card with a gutter under it, not a slab welded to the
          bottom edge. Everything else on this page floats over the map; a bar
          that does not is the one element that looks bolted on. */}
      <div className="nav-bottom">
        <div className="nav-card nav-bar">
          <div className="nav-left">
            <span className="nav-eta">{progress ? formatDuration(progress.remainingS) : "—"}</span>
            <small>
              {progress
                ? `${formatDistance(progress.remainingM)} · ${clockAt(progress.remainingS)}`
                : "waiting for a position"}
            </small>
          </div>

          {/* Only offered once it is useful — while the map is already on the
              walker there is nothing to recentre. */}
          {!following && (
            <button type="button" className="nav-recentre" onClick={onRecentre}>
              <span aria-hidden="true">◎</span> Recentre
            </button>
          )}

          <button type="button" className="nav-exit" onClick={onExit}>
            {arrived ? "Done" : "Exit"}
          </button>
        </div>
      </div>

    </>
  );
}
