"use client";

/**
 * "Route A", "Route B", "Route C" — ONE label, drawn the same everywhere: on
 * the map, beside the bars, on the timeline, in the side panel and the legend.
 * Meeting of 25 Nov 2026: "always Route B … exactly as you have it in the
 * map, exactly as it looks like, in all cases. So I immediately know this is
 * exactly the same idea."
 *
 * The route's colour as the background, white text. A selected route is shown
 * by OPACITY (full vs `ROUTE_UNSELECTED_OPACITY`) and an outline — never by a
 * second colour, which made route C read as related to whatever else was blue.
 * The map's Leaflet label is HTML from `routeChipHtml`, the same class names.
 */

import { routeLetter } from "@/lib/evidence";

export function routeChipClass(index: number, on: boolean): string {
  return `route-chip r${Math.min(index, 2)}${on ? " on" : ""}`;
}

export function routeChipHtml(index: number, on: boolean): string {
  return `<span class="${routeChipClass(index, on)}">Route ${routeLetter(index)}</span>`;
}

export default function RouteChip({ index, on = true, onClick, note }: { index: number; on?: boolean; onClick?: () => void; note?: string }) {
  const label = `Route ${routeLetter(index)}`;
  if (onClick) {
    return (
      <button type="button" className={routeChipClass(index, on)} aria-pressed={on} onClick={onClick} title={note}>
        {label}
      </button>
    );
  }
  return <span className={routeChipClass(index, on)} title={note}>{label}</span>;
}

/** The same chip inside an SVG (the timeline). */
export function RouteChipSvg({ index, on, x, y }: { index: number; on: boolean; x: number; y: number }) {
  const fill = ["var(--route-a)", "var(--route-b)", "var(--route-c)"][Math.min(index, 2)];
  return (
    <g opacity={on ? 1 : 0.8}>
      <rect x={x} y={y} width={62} height={20} rx={3} style={{ fill, stroke: on ? "var(--ink)" : "none" }} strokeWidth={on ? 1.5 : 0} />
      <text x={x + 31} y={y + 14} textAnchor="middle" className="route-chip-text">Route {routeLetter(index)}</text>
    </g>
  );
}
