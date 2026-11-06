"use client";

/**
 * "What matters most to you?" — the order that shades the report dots.
 *
 * The designer's default is shown, not hidden ("make the assumption
 * transparent"), and the reader can DRAG a kind to another place in the list
 * — or use the arrows, which is the same move for a keyboard or a phone,
 * where HTML drag-and-drop does not fire. The top of the list is the darkest,
 * most opaque dot; the bottom is little more than an outline.
 *
 * Shared by every board through `EvidenceProvider`, and remembered in this
 * browser. It changes what stands out on the map — never what is counted.
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from "lucide-react";

import { useEvidence } from "@/components/EvidenceProvider";
import { DEFAULT_ORDER, IMPORTANCE_ITEMS, moveKey, type ImportanceKey } from "@/lib/importance";
import { REPORT_OPACITY, REPORT_RADIUS } from "@/lib/palette";

const LABEL = new Map(IMPORTANCE_ITEMS.map((item) => [item.id, item]));

/** One dot as the map draws that rank — the legend IS the control. */
export function RankDot({ rank, size = 12 }: { rank: number; size?: number }) {
  const last = REPORT_RADIUS.length - 1;
  const r = REPORT_RADIUS[Math.min(rank, last)]!;
  const opacity = REPORT_OPACITY[Math.min(rank, last)]!;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="rank-dot">
      <circle cx={7} cy={7} r={r} style={{ fill: `var(--rank-${rank})`, stroke: rank === last ? "var(--rank-2)" : "var(--card)" }} fillOpacity={opacity} strokeWidth={1} />
    </svg>
  );
}

export default function ImportancePanel({ compact = false }: { compact?: boolean }) {
  const { order, setOrder } = useEvidence();
  const [dragging, setDragging] = useState<ImportanceKey | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const changed = order.some((key, i) => key !== DEFAULT_ORDER[i]);

  return (
    <div className={`importance${compact ? " compact" : ""}`}>
      <p className="card-sub">
        Darker dots = what you count as more serious. Drag to change the order.
        {" "}A place with several reasons takes its most serious one.
      </p>
      <ol className="importance-list">
        {order.map((key, i) => {
          const item = LABEL.get(key)!;
          return (
            <li
              key={key}
              draggable
              className={`${dragging === key ? "dragging" : ""}${over === i ? " over" : ""}`}
              onDragStart={(event) => { setDragging(key); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", key); }}
              onDragOver={(event) => { event.preventDefault(); setOver(i); }}
              onDragLeave={() => setOver((current) => (current === i ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const moved = (event.dataTransfer.getData("text/plain") || dragging) as ImportanceKey | null;
                if (moved) setOrder(moveKey(order, moved, i));
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => { setDragging(null); setOver(null); }}
              title={item.hint}
            >
              <GripVertical size={14} aria-hidden className="grip" />
              <RankDot rank={i} />
              <span className="importance-label">{item.label}</span>
              <span className="importance-move">
                <button type="button" aria-label={`Move "${item.label}" up`} disabled={i === 0} onClick={() => setOrder(moveKey(order, key, i - 1))}><ArrowUp size={13} /></button>
                <button type="button" aria-label={`Move "${item.label}" down`} disabled={i === order.length - 1} onClick={() => setOrder(moveKey(order, key, i + 1))}><ArrowDown size={13} /></button>
              </span>
            </li>
          );
        })}
      </ol>
      {changed && (
        <button type="button" className="link reset" onClick={() => setOrder(DEFAULT_ORDER)}>
          <RotateCcw size={12} aria-hidden /> Back to the default order
        </button>
      )}
    </div>
  );
}
