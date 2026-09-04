"use client";

/**
 * The layer filters.
 *
 * Three groups, in the colours the brief names them: crime purple, safe spots
 * pink, lighting yellow. Each group says what its data actually is — a filter
 * that silently draws nothing is indistinguishable from a filter that found
 * nothing, and those are very different answers.
 */

import { SAFE_SPOTS } from "@/lib/layers";
import { CRIME_CATEGORIES } from "@/lib/reports";

interface Props {
  spots: string[];
  onSpots: (ids: string[]) => void;
  lighting: boolean;
  onLighting: (on: boolean) => void;
  crime: string[];
  onCrime: (ids: string[]) => void;
  reportMode: boolean;
  onReportMode: (on: boolean) => void;
  reportCategory: string;
  onReportCategory: (id: string) => void;
  reportCount: number;
  /** How many reports the current crime filter is hiding. */
  hiddenReports: number;
  zoomedOut: boolean;
  layerError: string | null;
  truncated: boolean;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export default function FilterPanel({
  spots, onSpots, lighting, onLighting, crime, onCrime,
  reportMode, onReportMode, reportCategory, onReportCategory,
  reportCount, hiddenReports, zoomedOut, layerError, truncated,
}: Props) {
  return (
    <div className="filters">
      {/* ── crime ─────────────────────────────────────────────────────────── */}
      <details className="filter crime">
        <summary>
          <span className="swatch" /> Crime
          <span className="count">{reportCount || ""}</span>
        </summary>

        <p className="filter-note">
          There is no open dataset of where harassment, catcalling or assault happened —
          police figures are published per neighbourhood per month, which cannot tell one
          street from the next. So this layer holds <strong>reports entered here</strong>,
          kept in this browser only. It starts empty, and an empty map means nothing was
          written down, not that nothing happened. It never affects the route score.
        </p>

        {CRIME_CATEGORIES.map((category) => (
          <label key={category.id} className="check">
            <input
              type="checkbox"
              checked={crime.includes(category.id)}
              onChange={() => onCrime(toggle(crime, category.id))}
            />
            {category.label}
          </label>
        ))}

        <div className="report-add">
          <label className="check">
            <input
              type="checkbox"
              checked={reportMode}
              onChange={(event) => onReportMode(event.target.checked)}
            />
            Add a report by clicking the map
          </label>
          {reportMode && (
            <select value={reportCategory} onChange={(event) => onReportCategory(event.target.value)}>
              {CRIME_CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>{category.label}</option>
              ))}
            </select>
          )}
        </div>

        {hiddenReports > 0 && (
          <p className="filter-note">
            {hiddenReports} report{hiddenReports === 1 ? "" : "s"} hidden by the boxes above.
          </p>
        )}
      </details>

      {/* ── safe spots ────────────────────────────────────────────────────── */}
      <details className="filter safe" open>
        <summary>
          <span className="swatch" /> Safe spots
          <span className="count">{spots.length || ""}</span>
        </summary>

        <p className="filter-note">
          Somewhere with a door, a light and usually a person — places to walk towards,
          not places guaranteed to help. Straight from OpenStreetMap.
        </p>

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
            />
            <span className="glyph">{kind.icon}</span>
            {kind.label}
            {kind.note && <small>{kind.note}</small>}
          </label>
        ))}
      </details>

      {/* ── lighting ──────────────────────────────────────────────────────── */}
      <details className="filter light" open>
        <summary>
          <span className="swatch" /> Lighting
        </summary>
        <label className="check">
          <input type="checkbox" checked={lighting} onChange={(event) => onLighting(event.target.checked)} />
          Street lamps and lit streets
        </label>
        <p className="filter-note">
          Yellow lines are streets tagged <code>lit=yes</code>; dots are individual lamps.
          Most streets in most cities carry no lighting tag at all, so an unmarked street
          is one nobody has surveyed — not a dark one.
        </p>
      </details>

      {zoomedOut && (spots.length > 0 || lighting) && (
        <p className="hint">Zoom in to load these layers — the area on screen is too big to query.</p>
      )}
      {truncated && <p className="hint">Showing part of what is here; zoom in for the rest.</p>}
      {layerError && <p className="error">{layerError}</p>}
    </div>
  );
}
