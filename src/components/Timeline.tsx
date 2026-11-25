"use client";

/**
 * "Compare the routes along the way" — every route on one 0–100% progress
 * axis, five tracks each, in the SAME order and with the SAME names as the
 * bars above (`FACTOR_GROUPS` in `CompareBoard.tsx`): lighting, places to go
 * in, reported places, crowd, parks & underpasses. Meeting of 25 Nov 2026: "if
 * there is no reason for the inconsistency, remain consistent."
 *
 * Coordinated with the map: hovering or tapping the selected route's tracks
 * moves a cursor here AND on the map; tapping a route on the map moves it
 * here. Kept as it was — "the one that helps me the most … everyone
 * loved it" — with parks now GREEN, report dots shaded by how serious they
 * read, and a crowd track (busy streets as +, bars as small squares).
 *
 * Progress, not metres, so the three line up; the board's footnote says the
 * distances differ. Drag across the SELECTED route's tracks to brush an
 * interval — the map highlights it and the panel beside describes it. Click
 * another route to select it.
 */

import { useRef } from "react";

import { useSvgId, useWidth, Hatch } from "@/components/charts";
import { RouteChipSvg } from "@/components/RouteChip";
import { SOURCE_LABEL, type Report } from "@/lib/reports";
import { REPORT_OPACITY, REPORT_RADIUS } from "@/lib/palette";
import { type RouteEvidence } from "@/lib/evidence";

/** Same names, same order as the bars' group headers. */
export const TRACKS = ["Lighting", "Places to go in", "Reported places", "Crowd", "Parks & underpasses"] as const;

interface Props {
  evidence: (RouteEvidence | null)[];
  inks: string[];
  hidden: boolean[];
  selected: number;
  onSelect: (index: number) => void;
  brush: [number, number] | null;
  onBrush: (range: [number, number] | null) => void;
  /** How serious a report reads, 0 = most — its shade. */
  rankOf?: (report: Report) => number;
  /** The point being looked at on the selected route (0–1), shared with the map. */
  cursor: number | null;
  onCursor: (at: number | null) => void;
  /** Reports switched off by the reader: say so, never draw an empty track. */
  reportsHidden?: boolean;
}

const HEART = "M12 21s-6.7-4.35-9.33-8.1C.6 9.95 2.02 5.5 6.04 5.5c2.3 0 3.6 1.4 4.46 2.66.86-1.26 2.16-2.66 4.46-2.66 4.02 0 5.44 4.45 3.37 7.4C18.7 16.65 12 21 12 21z";

export default function Timeline({ evidence, inks, hidden, selected, onSelect, brush, onBrush, rankOf, cursor, onCursor, reportsHidden = false }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>(700);
  const hatch = useSvgId("tl-hatch");
  const narrow = width < 560;
  const nameW = narrow ? 72 : 110;
  const trackW = narrow ? 104 : 140;
  const right = 14;
  const top = 30;
  const trackH = narrow ? 20 : 21;
  const gap = 10;
  const blockH = TRACKS.length * trackH + gap * 2;
  const plotX = nameW + trackW;
  const plotW = Math.max(80, width - plotX - right);
  const x = (fraction: number) => plotX + fraction * plotW;
  const height = top + evidence.length * blockH + 34;
  const drag = useRef<number | null>(null);

  const fractionAt = (clientX: number, svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - box.left - plotX) / plotW));
  };
  const blockAt = (clientY: number, svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    return Math.floor((clientY - box.top - top) / blockH);
  };

  return (
    <div ref={ref} className="chart timeline">
      <svg
        width={width}
        height={height}
        className="brushable"
        onPointerDown={(event) => {
          const svg = event.currentTarget;
          const block = blockAt(event.clientY, svg);
          if (block < 0 || block >= evidence.length) return;
          if (block !== selected) {
            onSelect(block);
            return;
          }
          const box = svg.getBoundingClientRect();
          if (event.clientX - box.left < plotX) return;
          const at = fractionAt(event.clientX, svg);
          drag.current = at;
          svg.setPointerCapture(event.pointerId);
          onBrush([at, at]);
        }}
        onPointerMove={(event) => {
          const svg = event.currentTarget;
          if (drag.current === null) {
            // Hover along the selected route: the map's cursor follows.
            const box = svg.getBoundingClientRect();
            if (blockAt(event.clientY, svg) === selected && event.clientX - box.left >= plotX) onCursor(fractionAt(event.clientX, svg));
            return;
          }
          onBrush([drag.current, fractionAt(event.clientX, svg)]);
        }}
        onPointerUp={() => {
          // A tap, not a drag: mark that one point, here and on the map.
          if (drag.current !== null && brush && Math.abs(brush[1] - brush[0]) < 0.01) {
            onBrush(null);
            onCursor(drag.current);
          }
          drag.current = null;
        }}
        role="img"
        aria-label="Factors along each route, by progress"
      >
        <defs><Hatch id={hatch} /></defs>

        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <text x={x(tick / 100)} y={12} textAnchor="middle" className="tick">{tick}</text>
            <line x1={x(tick / 100)} x2={x(tick / 100)} y1={18} y2={top + evidence.length * blockH} className={tick === 0 || tick === 100 ? "axis" : "grid dashed"} />
          </g>
        ))}

        {evidence.map((ev, i) => {
          const y0 = top + i * blockH;
          const on = i === selected;
          const ink = inks[i] ?? "var(--ink)";
          const yTrack = (t: number) => y0 + gap + t * trackH;
          return (
            <g key={i} opacity={hidden[i] ? 0.35 : 1}>
              <line x1={0} x2={width} y1={y0 + blockH} y2={y0 + blockH} className="grid" />
              <RouteChipSvg index={i} on={on} x={2} y={y0 + gap} />
              {ev && <text x={4} y={y0 + gap + 38} className="tick">{Math.round(ev.minutes)} min</text>}
              <line x1={nameW - 6} x2={nameW - 6} y1={y0 + gap} y2={y0 + blockH - gap} style={{ stroke: ink }} strokeWidth={2} opacity={on ? 1 : 0.8} />
              {TRACKS.map((track, t) => (
                <text
                  key={track}
                  x={nameW + 2}
                  y={yTrack(t) + trackH / 2 + 4}
                  className={`track-label${t === 2 && reportsHidden ? " struck" : ""}`}
                >
                  {narrow && t === 4 ? "Parks & ∩" : track}
                </text>
              ))}

              {!ev ? (
                <text x={plotX + 8} y={yTrack(1) + 6} className="tick">Reading what OpenStreetMap records along this route…</text>
              ) : (
                <>
                  {/* lighting: lit / unlit / unknown, end to end */}
                  {ev.lighting.map((run, r) => (
                    <rect
                      key={r}
                      x={x(run.from)}
                      y={yTrack(0) + 4}
                      width={Math.max(0.5, x(run.to) - x(run.from))}
                      height={trackH - 8}
                      style={{ fill: run.value === "yes" ? "var(--lit)" : run.value === "no" ? "var(--unlit)" : `url(#${hatch})` }}
                    />
                  ))}
                  {ev.lighting.length === 0 && (
                    <rect x={x(0)} y={yTrack(0) + 4} width={plotW} height={trackH - 8} style={{ fill: `url(#${hatch})` }} />
                  )}
                  {/* places */}
                  <line x1={x(0)} x2={x(1)} y1={yTrack(1) + trackH / 2} y2={yTrack(1) + trackH / 2} className="track" />
                  {ev.places.map((mark, m) => (
                    <path key={m} d={HEART} transform={`translate(${x(mark.at) - 6.5} ${yTrack(1) + 3}) scale(0.54)`} style={{ fill: "var(--place)" }}>
                      <title>{mark.item.name ?? mark.item.label}</title>
                    </path>
                  ))}
                  {/* reports — or, switched off, a sentence saying so (never an empty track) */}
                  {reportsHidden ? (
                    <text x={plotX + 4} y={yTrack(2) + trackH / 2 + 4} className="tick hidden-note">Hidden — you switched reported places off (above)</text>
                  ) : (
                    <line x1={x(0)} x2={x(1)} y1={yTrack(2) + trackH / 2} y2={yTrack(2) + trackH / 2} className="track" />
                  )}
                  {!reportsHidden && [...ev.reports]
                    .map((mark) => ({ mark, rank: rankOf ? rankOf(mark.item) : 0 }))
                    .sort((a, b) => b.rank - a.rank)
                    .map(({ mark, rank }, m) => {
                      const r = Math.min(rank, REPORT_RADIUS.length - 1);
                      return (
                        <circle
                          key={m}
                          cx={x(mark.at)}
                          cy={yTrack(2) + trackH / 2}
                          r={Math.min(5.5, REPORT_RADIUS[r]! * 0.85)}
                          style={{ fill: `var(--rank-${r})`, stroke: r === REPORT_RADIUS.length - 1 ? "var(--rank-2)" : "var(--card)" }}
                          fillOpacity={REPORT_OPACITY[r]}
                          strokeWidth={0.8}
                        >
                          <title>{SOURCE_LABEL[mark.item.source]}{mark.item.place ? ` · ${mark.item.place}` : ""}{mark.item.note ? ` — "${mark.item.note.slice(0, 120)}${mark.item.note.length > 120 ? "…" : ""}"` : ""}</title>
                        </circle>
                      );
                    })}
                  {/* crowd: busy streets (+) and bars (square) */}
                  <line x1={x(0)} x2={x(1)} y1={yTrack(3) + trackH / 2} y2={yTrack(3) + trackH / 2} className="track" />
                  {ev.busy.map((mark, m) => (
                    <path key={`b${m}`} d={`M ${x(mark.at)} ${yTrack(3) + 5} v ${trackH - 10} M ${x(mark.at) - 4} ${yTrack(3) + trackH / 2} h 8`} style={{ stroke: "var(--crowd)" }} strokeWidth={2} strokeLinecap="round">
                      <title>{mark.item.name ?? mark.item.label}</title>
                    </path>
                  ))}
                  {ev.nightlife.map((mark, m) => (
                    <rect key={`n${m}`} x={x(mark.at) - 3} y={yTrack(3) + trackH / 2 - 3} width={6} height={6} style={{ fill: "var(--nightlife)" }} fillOpacity={0.85}>
                      <title>{mark.item.name ? `${mark.item.name} · ${mark.item.label}` : mark.item.label}</title>
                    </rect>
                  ))}
                  {/* parks (green) and underpasses (∩) */}
                  <line x1={x(0)} x2={x(1)} y1={yTrack(4) + trackH / 2} y2={yTrack(4) + trackH / 2} className="track" />
                  {ev.parks.map((run, r) => (
                    <rect key={r} x={x(run.from)} y={yTrack(4) + 5} width={Math.max(2, x(run.to) - x(run.from))} height={trackH - 10} rx={2} style={{ fill: "var(--park)" }}>
                      <title>Through a park</title>
                    </rect>
                  ))}
                  {ev.underpasses.map((mark, m) => (
                    <path
                      key={m}
                      d={`M ${x(mark.at) - 6} ${yTrack(4) + trackH - 4} v -5 a 6 6 0 0 1 12 0 v 5`}
                      fill="none"
                      style={{ stroke: "var(--ink)" }}
                      strokeWidth={2}
                    >
                      <title>Underpass</title>
                    </path>
                  ))}
                </>
              )}

              {on && cursor !== null && (
                <g pointerEvents="none">
                  <line x1={x(cursor)} x2={x(cursor)} y1={y0 + 2} y2={y0 + blockH - 2} className="cursor-line" />
                  <circle cx={x(cursor)} cy={y0 + 4} r={4} className="cursor-dot" />
                </g>
              )}
              {on && brush && (
                <g pointerEvents="none">
                  <rect x={x(Math.min(...brush))} y={y0 + 4} width={Math.max(1, x(Math.max(...brush)) - x(Math.min(...brush)))} height={blockH - 8} className="brush" />
                  <line x1={x(Math.min(...brush))} x2={x(Math.min(...brush))} y1={y0 + 2} y2={y0 + blockH - 2} className="brush-edge dashed" />
                  <line x1={x(Math.max(...brush))} x2={x(Math.max(...brush))} y1={y0 + 2} y2={y0 + blockH - 2} className="brush-edge dashed" />
                </g>
              )}
            </g>
          );
        })}

        <text x={plotX + plotW / 2} y={height - 8} textAnchor="middle" className="axis-title">Progress along each route (%)</text>
      </svg>
    </div>
  );
}
