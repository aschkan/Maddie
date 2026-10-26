"use client";

/**
 * The dashboard's charts — hand-drawn SVG, one component per chart TYPE.
 *
 * Each board picks the chart from the data, never from taste
 * (`docs/Maddie-Evidence-Dashboard.md` § "Chart chooser"):
 *
 *   categorical × count      → horizontal bars      (`GroupedBars`, `RankBars`)
 *   part of a whole          → donut                (`Donut`)
 *   continuous distribution  → histogram, brushable (`Histogram`)
 *   composition per category → 100% stacked bar     (`StackedShare`)
 *   series over time         → line                 (`Lines`)
 *   several items × factors  → dot plot / radar     (`DotColumn`, `Radar`)
 *   two categories × count   → heatmap              (`Heatmap`)
 *
 * Every chart is drawn at its container's real pixel width (`useWidth`), not
 * scaled through a viewBox — a scaled chart has 7px axis labels on a phone.
 * Colours are CSS custom properties (`var(--report)`…), so a theme switch
 * repaints every chart without a re-render.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { niceMax, ticks } from "@/lib/evidence";

/* ── plumbing ─────────────────────────────────────────────────────────── */

export function useWidth<T extends HTMLElement>(fallback = 320): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? fallback);
      if (next > 0) setWidth(next);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width];
}

/** An id safe inside `url(#…)` — React's own ids carry characters that are not. */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

/** The diagonal hatch that means "unknown" everywhere on these boards. */
export function Hatch({ id, colour = "var(--unknown)" }: { id: string; colour?: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
      <rect width="6" height="6" style={{ fill: "var(--card)" }} />
      <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: colour }} strokeWidth="2.4" />
    </pattern>
  );
}

/** Ticks that land on round numbers: 4, 5 or 2 gaps, whichever divides evenly. */
export function roundTicks(max: number): number[] {
  const gaps = [4, 5, 2].find((n) => Number.isInteger(max / n)) ?? 2;
  return ticks(max, gaps);
}

const fmt = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** A legend row: swatches with labels. */
export function Key({ items }: { items: { label: ReactNode; swatch: ReactNode }[] }) {
  return (
    <div className="key">
      {items.map((item, i) => (
        <span key={i} className="key-item">{item.swatch}{item.label}</span>
      ))}
    </div>
  );
}

export function Swatch({ colour, hatch = false, round = false }: { colour: string; hatch?: boolean; round?: boolean }) {
  return (
    <i
      className={`sw${hatch ? " sw-hatch" : ""}${round ? " sw-round" : ""}`}
      style={hatch ? undefined : { background: colour }}
      aria-hidden
    />
  );
}

/* ── grouped horizontal bars ──────────────────────────────────────────── */

export interface GroupedRow {
  id: string;
  label: string;
  value: number;
  context: number;
}

/**
 * Selection in front, everything displayed behind it — the selected area's
 * count against the whole city's, per category. Clicking a row picks it.
 */
export function GroupedBars({
  rows, focus, onPick, axisLabel, labelWidth = 92,
}: {
  rows: GroupedRow[];
  focus: string | null;
  onPick: (id: string) => void;
  axisLabel: string;
  /** Room for the row labels; long labels need more than the default. */
  labelWidth?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelW = Math.min(labelWidth, Math.max(92, width * 0.45));
  const right = 18;
  const rowH = 54;
  const top = 6;
  const max = niceMax(Math.max(1, ...rows.map((row) => Math.max(row.value, row.context))));
  const plotW = Math.max(60, width - labelW - right);
  const x = (value: number) => labelW + (value / max) * plotW;
  const height = top + rows.length * rowH + 40;
  const axis = roundTicks(max);

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label="Bar chart">
        {axis.map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={top} y2={top + rows.length * rowH} className="grid" />
            <text x={x(tick)} y={top + rows.length * rowH + 16} className="tick" textAnchor="middle">{fmt(tick)}</text>
          </g>
        ))}
        <text x={labelW + plotW / 2} y={height - 4} className="axis-title" textAnchor="middle">{axisLabel}</text>
        {rows.map((row, i) => {
          const y = top + i * rowH + 9;
          const dim = focus !== null && focus !== row.id;
          return (
            <g
              key={row.id}
              className={`pick${dim ? " dim" : ""}`}
              onClick={() => onPick(row.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onPick(row.id); }}
              aria-pressed={focus === row.id}
            >
              <rect x={0} y={y - 9} width={width} height={rowH} fill="transparent" />
              <text x={labelW - 10} y={y + 16} className="row-label" textAnchor="end">{row.label}</text>
              <rect x={labelW} y={y} width={Math.max(0, x(row.value) - labelW)} height={18} style={{ fill: "var(--report)" }} />
              <rect x={labelW} y={y + 20} width={Math.max(0, x(row.context) - labelW)} height={16} style={{ fill: "var(--context)" }} />
              <text x={x(row.value) + 5} y={y + 13.5} className="value" style={{ fill: "var(--report)" }}>{row.value}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── histogram with a brush ───────────────────────────────────────────── */

export function Histogram({
  bins, binLabel, tickEvery, xLabel, yLabel, brush, onBrush, brushHint, height = 210, colour = "var(--report)",
}: {
  bins: number[];
  /** Label for the tick at bin index `i`. */
  binLabel: (i: number) => string;
  /** Which bin indices carry a tick. */
  tickEvery: number[];
  xLabel: string;
  yLabel: string;
  /** Inclusive bin range, or null. */
  brush?: [number, number] | null;
  onBrush?: (range: [number, number] | null) => void;
  brushHint?: string;
  height?: number;
  colour?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const left = 40;
  const right = 10;
  const top = brushHint ? 26 : 10;
  const bottom = 42;
  const plotW = Math.max(60, width - left - right);
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(1, ...bins));
  const step = plotW / Math.max(1, bins.length);
  const y = (value: number) => top + plotH - (value / max) * plotH;
  const drag = useRef<number | null>(null);

  const binAt = useCallback((clientX: number, svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    return Math.max(0, Math.min(bins.length - 1, Math.floor((clientX - box.left - left) / step)));
  }, [bins.length, step]);

  const range = brush ? [Math.min(...brush), Math.max(...brush)] as const : null;

  return (
    <div ref={ref} className="chart">
      <svg
        width={width}
        height={height}
        className={onBrush ? "brushable" : undefined}
        onPointerDown={onBrush ? (event) => {
          const at = binAt(event.clientX, event.currentTarget);
          drag.current = at;
          event.currentTarget.setPointerCapture(event.pointerId);
          onBrush([at, at]);
        } : undefined}
        onPointerMove={onBrush ? (event) => {
          if (drag.current === null) return;
          onBrush([drag.current, binAt(event.clientX, event.currentTarget)]);
        } : undefined}
        onPointerUp={onBrush ? (event) => {
          if (drag.current !== null && binAt(event.clientX, event.currentTarget) === drag.current && range && range[0] === range[1]) {
            onBrush(null);
          }
          drag.current = null;
        } : undefined}
        role="img"
        aria-label={`Histogram: ${yLabel} by ${xLabel}`}
      >
        {roundTicks(max).map((tick) => (
          <g key={tick}>
            <line x1={left} x2={left + plotW} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={left - 6} y={y(tick) + 4} className="tick" textAnchor="end">{fmt(tick)}</text>
          </g>
        ))}
        {range && (
          <g>
            <rect x={left + range[0] * step} y={top} width={(range[1] - range[0] + 1) * step} height={plotH} className="brush" />
            <line x1={left + range[0] * step} x2={left + range[0] * step} y1={top} y2={top + plotH} className="brush-edge" />
            <line x1={left + (range[1] + 1) * step} x2={left + (range[1] + 1) * step} y1={top} y2={top + plotH} className="brush-edge" />
          </g>
        )}
        {brushHint && range && (
          <g className="brush-hint">
            <text x={left + ((range[0] + range[1] + 1) / 2) * step} y={10} textAnchor="middle">{brushHint}</text>
            <line x1={left + range[0] * step + 2} x2={left + (range[1] + 1) * step - 2} y1={18} y2={18} markerStart="url(#arrow)" markerEnd="url(#arrow)" />
          </g>
        )}
        {brushHint && !range && (
          <text x={left + plotW} y={10} textAnchor="end" className="brush-hint-idle">{brushHint} — drag across the bars</text>
        )}
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: "var(--selection)" }} />
          </marker>
        </defs>
        {bins.map((value, i) => {
          const inside = !range || (i >= range[0] && i <= range[1]);
          return (
            <rect
              key={i}
              x={left + i * step + 1}
              y={y(value)}
              width={Math.max(1, step - 2)}
              height={top + plotH - y(value)}
              style={{ fill: colour, opacity: inside ? 1 : 0.35 }}
            >
              <title>{`${binLabel(i)}: ${value}`}</title>
            </rect>
          );
        })}
        <line x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} className="axis" />
        {tickEvery.map((i) => (
          <text key={i} x={left + i * step + step / 2} y={top + plotH + 16} className="tick" textAnchor="middle">{binLabel(i)}</text>
        ))}
        <text x={left + plotW / 2} y={height - 6} className="axis-title" textAnchor="middle">{xLabel}</text>
        <text transform={`translate(11 ${top + plotH / 2}) rotate(-90)`} className="axis-title" textAnchor="middle">{yLabel}</text>
      </svg>
    </div>
  );
}

/* ── 100% stacked bars: lit / unlit / unknown ─────────────────────────── */

export interface ShareRow {
  id: string;
  label: string;
  lit: number;
  unlit: number;
  unknown: number;
}

export function StackedShare({
  rows, selected, onPick, axisLabel,
}: {
  rows: ShareRow[];
  selected: string[];
  onPick?: (id: string) => void;
  axisLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const hatch = useSvgId("hatch");
  const labelW = 74;
  const right = 12;
  const rowH = 36;
  const top = 4;
  const plotW = Math.max(60, width - labelW - right);
  const x = (pct: number) => labelW + (pct / 100) * plotW;
  const height = top + rows.length * rowH + 40;

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label="Stacked bar chart">
        <defs><Hatch id={hatch} /></defs>
        {ticks(100, 5).map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={top} y2={top + rows.length * rowH} className="grid" />
            <text x={x(tick)} y={top + rows.length * rowH + 16} className="tick" textAnchor="middle">{tick}</text>
          </g>
        ))}
        <text x={labelW + plotW / 2} y={height - 4} className="axis-title" textAnchor="middle">{axisLabel}</text>
        {rows.map((row, i) => {
          const y = top + i * rowH + 5;
          const h = rowH - 10;
          const parts = [
            { key: "lit", value: row.lit, fill: "var(--lit)", text: "var(--on-lit)" },
            { key: "unlit", value: row.unlit, fill: "var(--unlit)", text: "var(--on-unlit)" },
            { key: "unknown", value: row.unknown, fill: `url(#${hatch})`, text: "var(--ink-2)" },
          ];
          let at = 0;
          const isSelected = selected.includes(row.id);
          return (
            <g
              key={row.id}
              className={onPick ? "pick" : undefined}
              onClick={onPick ? () => onPick(row.id) : undefined}
            >
              <text x={labelW - 8} y={y + h / 2 + 4} className={`row-label${isSelected ? " strong" : ""}`} textAnchor="end">{row.label}</text>
              {parts.map((part) => {
                const x0 = x(at);
                at += part.value;
                const w = x(at) - x0;
                return (
                  <g key={part.key}>
                    <rect x={x0} y={y} width={Math.max(0, w)} height={h} style={{ fill: part.fill }} className={part.key === "unknown" ? "hatched" : undefined} />
                    {w > 26 && (
                      <text x={x0 + w / 2} y={y + h / 2 + 4} textAnchor="middle" className="seg-label" style={{ fill: part.text }}>
                        {Math.round(part.value)}%
                      </text>
                    )}
                  </g>
                );
              })}
              {isSelected && <rect x={labelW - 1} y={y - 1} width={x(at) - labelW + 2} height={h + 2} className="selected-outline" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── donut: part of a whole ───────────────────────────────────────────── */

export function Donut({
  parts, focus, onPick, centre,
}: {
  parts: { id: string; label: string; value: number; colour: string }[];
  focus: string | null;
  onPick: (id: string) => void;
  centre: string;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const r = 70;
  const inner = 44;
  const size = 180;
  const arc = (from: number, to: number) => {
    const large = to - from > Math.PI ? 1 : 0;
    const p = (a: number, radius: number) => `${size / 2 + radius * Math.cos(a)} ${size / 2 + radius * Math.sin(a)}`;
    return `M ${p(from, r)} A ${r} ${r} 0 ${large} 1 ${p(to, r)} L ${p(to, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(from, inner)} Z`;
  };
  return (
    <div className="donut">
      <svg width={size} height={size} role="img" aria-label="Share of reports by type">
        {total === 0 && <circle cx={size / 2} cy={size / 2} r={(r + inner) / 2} className="empty-ring" strokeWidth={r - inner} />}
        {parts.map((part, index) => {
          if (part.value === 0) return null;
          const before = parts.slice(0, index).reduce((sum, p) => sum + p.value, 0);
          const from = -Math.PI / 2 + (before / total) * Math.PI * 2;
          const to = from + (part.value / total) * Math.PI * 2 - (parts.filter((p) => p.value > 0).length > 1 ? 0.012 : 0);
          const path = part.value === total
            ? `M ${size / 2} ${size / 2 - r} A ${r} ${r} 0 1 1 ${size / 2 - 0.01} ${size / 2 - r} L ${size / 2 - 0.01} ${size / 2 - inner} A ${inner} ${inner} 0 1 0 ${size / 2} ${size / 2 - inner} Z`
            : arc(from, to);
          return (
            <path
              key={part.id}
              d={path}
              style={{ fill: part.colour, opacity: focus && focus !== part.id ? 0.3 : 1 }}
              className="pick"
              onClick={() => onPick(part.id)}
            >
              <title>{`${part.label}: ${part.value}`}</title>
            </path>
          );
        })}
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" className="donut-total">{total}</text>
        <text x={size / 2} y={size / 2 + 15} textAnchor="middle" className="tick">{centre}</text>
      </svg>
      <ul className="donut-key">
        {parts.map((part) => (
          <li key={part.id} className={focus && focus !== part.id ? "dim" : undefined}>
            <button type="button" onClick={() => onPick(part.id)}>
              <Swatch colour={part.colour} />
              <span>{part.label}</span>
              <b>{total ? Math.round((100 * part.value) / total) : 0}%</b>
              <span className="muted">{part.value}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── lines over time ──────────────────────────────────────────────────── */

export function Lines({
  labels, series, yLabel, xLabel, height = 220, mark,
}: {
  labels: string[];
  series: { id: string; label: string; values: number[]; colour: string; dash?: string; width?: number }[];
  yLabel: string;
  xLabel: string;
  height?: number;
  /** An annotation at one index: a soft band and a label. */
  mark?: { at: number; label: string } | null;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const left = 40;
  const right = 12;
  const top = 12;
  const bottom = 42;
  const plotW = Math.max(60, width - left - right);
  const plotH = height - top - bottom;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => left + (labels.length <= 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (value: number) => top + plotH - (value / max) * plotH;
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(plotW / 48))));

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label={`Line chart: ${yLabel} by ${xLabel}`}>
        {roundTicks(max).map((tick) => (
          <g key={tick}>
            <line x1={left} x2={left + plotW} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={left - 6} y={y(tick) + 4} className="tick" textAnchor="end">{fmt(tick)}</text>
          </g>
        ))}
        {mark && (
          <g>
            <rect x={x(mark.at) - plotW / labels.length / 1.4} y={top} width={(plotW / labels.length) * 1.4} height={plotH} className="soft-band" />
            <text x={x(mark.at)} y={top + 12} textAnchor="middle" className="tick">{mark.label}</text>
          </g>
        )}
        {labels.map((label, i) => (i % every === 0 ? (
          <text key={label + i} x={x(i)} y={top + plotH + 16} className="tick" textAnchor="middle">{label}</text>
        ) : null))}
        <line x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} className="axis" />
        {series.map((s) => (
          <g key={s.id}>
            <polyline
              points={s.values.map((value, i) => `${x(i)},${y(value)}`).join(" ")}
              fill="none"
              style={{ stroke: s.colour }}
              strokeWidth={s.width ?? 2}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
            />
            {s.values.map((value, i) => (
              <circle key={i} cx={x(i)} cy={y(value)} r={2.5} style={{ fill: s.colour }}>
                <title>{`${s.label}, ${labels[i]}: ${value}`}</title>
              </circle>
            ))}
          </g>
        ))}
        <text x={left + plotW / 2} y={height - 6} className="axis-title" textAnchor="middle">{xLabel}</text>
        <text transform={`translate(11 ${top + plotH / 2}) rotate(-90)`} className="axis-title" textAnchor="middle">{yLabel}</text>
      </svg>
    </div>
  );
}

/* ── one factor, every route: a dot-plot column ───────────────────────── */

export interface DotRow {
  value: number | null;
  colour: string;
  /** Rows the trade-off slider set aside are drawn hollow and faded. */
  muted?: boolean;
}

export function DotColumn({
  title, max, rows, selected, onPick, rowH, unit = "",
}: {
  title: string;
  max: number;
  rows: DotRow[];
  selected: number;
  onPick: (index: number) => void;
  rowH: number;
  unit?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(140);
  const pad = 12;
  const plotW = Math.max(40, width - pad * 2 - 18);
  const x = (value: number) => pad + (Math.max(0, Math.min(max, value)) / max) * plotW;
  const top = 22;
  const height = top + rows.length * rowH + 6;
  // Four gaps only where they land on whole numbers and there is room for
  // five labels; otherwise three labels, which never collide.
  const axis = ticks(max, width >= 170 && Number.isInteger(max / 4) ? 4 : 2);

  return (
    <div ref={ref} className="dot-col">
      {/* HTML, not SVG text, so a long factor name wraps instead of running
          into its neighbour's. */}
      <div className="col-title">{title}</div>
      <svg width={width} height={height} role="img" aria-label={title}>
        {axis.map((tick) => (
          <g key={tick}>
            <text x={x(tick)} y={12} className="tick" textAnchor="middle">{fmt(Math.round(tick * 10) / 10)}</text>
            <line x1={x(tick)} x2={x(tick)} y1={18} y2={height - 4} className="grid faint" />
          </g>
        ))}
        {rows.map((row, i) => {
          const cy = top + i * rowH + rowH / 2;
          return (
            <g key={i} className="pick" onClick={() => onPick(i)}>
              {i === selected && <rect x={0} y={top + i * rowH} width={width} height={rowH} className="row-band" />}
              <rect x={0} y={top + i * rowH} width={width} height={rowH} fill="transparent" />
              <line x1={pad} x2={pad + plotW} y1={cy} y2={cy} className="track" />
              {row.value === null ? (
                <text x={pad} y={cy + 4} className="tick">reading…</text>
              ) : (
                <g opacity={row.muted ? 0.4 : 1}>
                  <circle
                    cx={x(row.value)}
                    cy={cy}
                    r={6.5}
                    style={row.muted ? { fill: "var(--card)", stroke: row.colour } : { fill: row.colour }}
                    strokeWidth={2}
                  />
                  <text x={x(row.value) + 10} y={cy + 4.5} className="dot-value" style={{ fill: row.colour }}>
                    {Math.round(row.value)}{unit}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── radar: every route on every factor, each axis its own scale ──────── */

export function Radar({
  axes, series, selected, onPick,
}: {
  /** Each axis: label, max of its OWN scale, and whether more is further out. */
  axes: { label: string; max: number }[];
  series: { label: string; values: (number | null)[]; colour: string; dash?: string; muted?: boolean }[];
  selected: number;
  onPick: (index: number) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const size = Math.min(width, 380);
  const cx = width / 2;
  const cy = size / 2 + 6;
  const r = size / 2 - 58;
  const angle = (i: number) => -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
  const point = (i: number, fraction: number) => [cx + Math.cos(angle(i)) * r * fraction, cy + Math.sin(angle(i)) * r * fraction] as const;

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={size + 12} role="img" aria-label="Radar chart of each route's factors">
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, i) => point(i, ring).join(",")).join(" ")}
            className="grid"
            fill="none"
          />
        ))}
        {axes.map((axis, i) => {
          const [x2, y2] = point(i, 1);
          const [lx, ly] = point(i, 1.2);
          const anchor = Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end";
          return (
            <g key={axis.label}>
              <line x1={cx} y1={cy} x2={x2} y2={y2} className="grid" />
              <text x={lx} y={ly} textAnchor={anchor} className="radar-axis">{axis.label}</text>
              <text x={lx} y={ly + 13} textAnchor={anchor} className="tick">0–{fmt(axis.max)}</text>
            </g>
          );
        })}
        {series.map((s, index) => {
          if (s.values.some((value) => value === null)) return null;
          const pts = s.values.map((value, i) => point(i, Math.max(0, Math.min(1, (value ?? 0) / (axes[i]?.max || 1)))));
          const isSelected = index === selected;
          return (
            <g key={s.label} className="pick" onClick={() => onPick(index)} opacity={s.muted ? 0.35 : 1}>
              <polygon
                points={pts.map((p) => p.join(",")).join(" ")}
                style={{ fill: s.colour, stroke: s.colour }}
                fillOpacity={isSelected ? 0.18 : 0.04}
                strokeWidth={isSelected ? 2.6 : 1.6}
                strokeDasharray={s.dash}
              />
              {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3} style={{ fill: s.colour }} />)}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── ranked bars, one highlighted ─────────────────────────────────────── */

export function RankBars({
  rows, highlight, axisLabel, onPick,
}: {
  rows: { id: string; label: string; value: number }[];
  highlight: string | null;
  axisLabel: string;
  onPick?: (id: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelW = 92;
  const right = 40;
  const rowH = 30;
  const max = niceMax(Math.max(1, ...rows.map((row) => row.value)));
  const plotW = Math.max(60, width - labelW - right);
  const x = (value: number) => labelW + (value / max) * plotW;
  const height = rows.length * rowH + 40;
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label="Ranked bar chart">
        {roundTicks(max).map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} x2={x(tick)} y1={0} y2={rows.length * rowH} className="grid" />
            <text x={x(tick)} y={rows.length * rowH + 16} className="tick" textAnchor="middle">{fmt(tick)}</text>
          </g>
        ))}
        <text x={labelW + plotW / 2} y={height - 4} className="axis-title" textAnchor="middle">{axisLabel}</text>
        {rows.map((row, i) => (
          <g key={row.id} className={onPick ? "pick" : undefined} onClick={onPick ? () => onPick(row.id) : undefined}>
            <text x={labelW - 8} y={i * rowH + 20} textAnchor="end" className={`row-label${row.id === highlight ? " strong" : ""}`}>{row.label}</text>
            <rect x={labelW} y={i * rowH + 7} width={Math.max(0, x(row.value) - labelW)} height={18} style={{ fill: row.id === highlight ? "var(--report)" : "var(--context)" }} />
            <text x={x(row.value) + 5} y={i * rowH + 20} className="value" style={{ fill: row.id === highlight ? "var(--report)" : "var(--ink-2)" }}>{row.value.toFixed(1)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ── heatmap: two categories × count ──────────────────────────────────── */

export function Heatmap({
  rows, cols, values, mark, xLabel, labelWidth = 36, labelEvery = 1,
}: {
  rows: string[];
  cols: string[];
  values: number[][];
  /** [row, col] to outline. */
  mark?: [number, number] | null;
  xLabel: string;
  labelWidth?: number;
  /** Label every n-th column (the last always). */
  labelEvery?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelW = labelWidth;
  const top = 4;
  const cell = Math.max(6, (width - labelW - 6) / cols.length);
  const rowH = 20;
  const max = Math.max(1, ...values.flat());
  const height = top + rows.length * rowH + 44;
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} role="img" aria-label="Heatmap">
        {rows.map((row, r) => (
          <g key={row}>
            <text x={labelW - 6} y={top + r * rowH + 14} textAnchor="end" className="tick">{row}</text>
            {cols.map((col, c) => {
              const value = values[r]?.[c] ?? 0;
              return (
                <rect
                  key={col}
                  x={labelW + c * cell}
                  y={top + r * rowH}
                  width={cell - 1}
                  height={rowH - 2}
                  style={{ fill: "var(--report)", fillOpacity: value === 0 ? 0.04 : 0.1 + 0.9 * (value / max) }}
                >
                  <title>{`${row} ${col}: ${value}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
        {mark && (
          <rect x={labelW + mark[1] * cell - 1} y={top + mark[0] * rowH - 1} width={cell + 1} height={rowH} className="now-outline" />
        )}
        {cols.map((col, c) => (c % labelEvery === 0 || c === cols.length - 1 ? (
          <text key={col} x={labelW + c * cell + cell / 2} y={top + rows.length * rowH + 14} textAnchor="middle" className="tick">{col}</text>
        ) : null))}
        <text x={labelW + (cols.length * cell) / 2} y={height - 4} textAnchor="middle" className="axis-title">{xLabel} · darker = more (max {max})</text>
      </svg>
    </div>
  );
}
