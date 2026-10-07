"use client";

/**
 * The Layers tab: make it YOURS — what counts, and what is on the map.
 *
 * The supervisor's third tab: "where you can influence what safety means …
 * every time I remove [something], everything is recomputed and I see
 * different things on the map." So the first block here is not about the map
 * at all: it is the factors the route reading is built from, each one a switch.
 * Turning one off re-scores every route at once, re-colours every stretch, may
 * move the star — and fetches nothing, because the counts are already here.
 *
 * The second block is what is drawn: the lighting layer and the places to go,
 * with the KINDS of place you consider worth walking towards. These are the
 * same switches as the legend's, one state shown in two places.
 *
 * Reports and police figures are the Reports tab — they are where you put your
 * own experience and read other people's, which is a different job from
 * deciding what a route reading is made of.
 */

import type { LayerId } from "@/components/Legend";
import { SAFE_SPOTS } from "@/lib/layers";
import { ALL_FACTORS, allOn, FACTORS, type Factors } from "@/lib/score";

interface Props {
  factors: Factors;
  onFactors: (next: Factors) => void;
  shown: Record<LayerId, boolean>;
  onShow: (layer: LayerId, on: boolean) => void;
  spots: string[];
  onSpots: (ids: string[]) => void;
  zoomedOut: boolean;
  layerError: string | null;
  truncated: boolean;
  /** In the scenario the layers are recorded, so "zoom in to load" never applies. */
  recorded: boolean;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export default function LayersPanel({
  factors, onFactors, shown, onShow, spots, onSpots, zoomedOut, layerError, truncated, recorded,
}: Props) {
  return (
    <div className="layers">
      <header className="panel-head">
        <h2>Make it yours</h2>
        <p className="hint">Choose what the route reading counts, and what the map shows.</p>
      </header>

      {/* ── what counts ─────────────────────────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <h3>What counts in the reading</h3>
          {!allOn(factors) && (
            <button type="button" className="ghost small" onClick={() => onFactors(ALL_FACTORS)}>Reset</button>
          )}
        </div>
        <p className="hint">Switch off anything that does not matter to you. Every route is re-read at once and the
          star may move — nothing is fetched again.</p>
        {FACTORS.map((factor) => (
          <label key={factor.id} className="check">
            <input
              type="checkbox"
              checked={factors[factor.id]}
              onChange={(event) => onFactors({ ...factors, [factor.id]: event.target.checked })}
            />
            {factor.label}
            <small>{factor.explain}</small>
          </label>
        ))}
      </section>

      {/* ── on the map ──────────────────────────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <h3><span className="sw sw-light" aria-hidden="true" /> Light</h3>
          <label className="switch">
            <input type="checkbox" checked={shown.lighting} onChange={(event) => onShow("lighting", event.target.checked)}
                   aria-label="Show lighting on the map" />
            <span aria-hidden="true" />
          </label>
        </div>
        <p className="hint">A glow around the lit stretches of your route, yellow lines along lit streets, dots for
          lamps. An unmarked street is one nobody has surveyed — not a dark one.</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h3><span className="sw sw-place" aria-hidden="true" /> Places to go</h3>
          <label className="switch">
            <input type="checkbox" checked={shown.places} onChange={(event) => onShow("places", event.target.checked)}
                   aria-label="Show places to go on the map" />
            <span aria-hidden="true" />
          </label>
        </div>
        <p className="hint">Somewhere with a door, a light and usually a person. Tick the kinds <em>you</em> would walk
          towards — they all show as the same pink heart.</p>
        <div className="quick">
          <button type="button" onClick={() => onSpots(SAFE_SPOTS.map((kind) => kind.id))}>All</button>
          <button type="button" onClick={() => onSpots([])}>None</button>
        </div>
        {SAFE_SPOTS.map((kind) => (
          <label key={kind.id} className="check">
            <input
              type="checkbox"
              checked={spots.includes(kind.id)}
              onChange={() => onSpots(toggle(spots, kind.id))}
              disabled={!shown.places}
            />
            <span className="glyph">{kind.icon}</span>
            {kind.label}
            {kind.note && <small>{kind.note}</small>}
          </label>
        ))}
      </section>

      {!recorded && zoomedOut && (shown.places || shown.lighting) && (
        <p className="hint">Zoom in to load these layers — the area on screen is too big to query.</p>
      )}
      {truncated && <p className="hint">Showing part of what is here; zoom in for the rest.</p>}
      {layerError && <p className="error">{layerError}</p>}
    </div>
  );
}
