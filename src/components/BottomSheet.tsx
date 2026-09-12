"use client";

/**
 * The panel, as a sheet you drag up from the bottom of a phone.
 *
 * The panel used to be a fixed 55vh block above the map, which is the worst of
 * both: never enough room to read the findings, and never enough map to see
 * where the dark stretch actually is. A sheet lets the same square inches be
 * either one, a thumb's flick apart.
 *
 * Three stops rather than free positioning — `peek` (the verdict and the tabs,
 * nothing else), `half`, `full`. A sheet that stays wherever you let go of it
 * ends up at some useless in-between height, and there is no right answer to
 * "what was it last time" on a page you open once a week.
 *
 * From 900px up this is a sidebar: the handle is not rendered, the height comes
 * from CSS, and none of the dragging below is reachable.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type Snap = "peek" | "half" | "full";

/** Tapping the handle cycles through them; dragging picks the nearest. */
const ORDER: Snap[] = ["peek", "half", "full"];

/** A press that moves less than this is a tap, not a drag. */
const TAP_SLOP_PX = 8;

const LABEL: Record<Snap, string> = {
  peek: "Open the panel",
  half: "Open the panel fully",
  full: "Close the panel",
};

interface Props {
  snap: Snap;
  onSnap: (snap: Snap) => void;
  /** Stays on screen at every stop — the one line worth seeing collapsed. */
  peek: ReactNode;
  /** The tab bar. Rendered last so it sits at the bottom, under the thumb. */
  tabs: ReactNode;
  children: ReactNode;
}

/**
 * What each stop is worth in pixels, for this viewport.
 *
 * Read from the stylesheet rather than repeated here. The CSS has to know these
 * to size the sheet at all, and the map's own buttons position themselves
 * against them too — three copies of "how far up does half go" is three places
 * for it to stop being the same number.
 */
function heights(): Record<Snap, number> {
  const view = window.innerHeight;
  const token = (name: string, fallback: number) => {
    const value = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(name),
    );
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    peek: token("--peek", 148),
    half: (view * token("--snap-half", 54)) / 100,
    full: (view * token("--snap-full", 92)) / 100,
  };
}

function nearest(height: number): Snap {
  const stops = heights();
  let best: Snap = "peek";
  for (const snap of ORDER) {
    if (Math.abs(stops[snap] - height) < Math.abs(stops[best] - height)) best = snap;
  }
  return best;
}

export default function BottomSheet({ snap, onSnap, peek, tabs, children }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startHeight: number; moved: boolean } | null>(null);
  const [live, setLive] = useState<number | null>(null);

  /*
   * A height dragged out at phone width must not survive a resize into the
   * sidebar layout, where the sheet is the full height of the window. The CSS
   * variable is what the rule reads, so dropping it here hands control back.
   */
  useEffect(() => {
    function forget() { setLive(null); }
    window.addEventListener("resize", forget);
    return () => window.removeEventListener("resize", forget);
  }, []);

  const cycle = useCallback(() => {
    const index = ORDER.indexOf(snap);
    onSnap(ORDER[(index + 1) % ORDER.length] ?? "peek");
  }, [snap, onSnap]);

  const down = (event: React.PointerEvent<HTMLButtonElement>) => {
    const box = sheet.current;
    if (!box) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: box.offsetHeight, moved: false };
  };

  const move = (event: React.PointerEvent<HTMLButtonElement>) => {
    const held = drag.current;
    if (!held) return;
    // Up is a smaller clientY and a taller sheet, hence the subtraction.
    const delta = held.startY - event.clientY;
    if (Math.abs(delta) > TAP_SLOP_PX) held.moved = true;
    if (!held.moved) return;

    const stops = heights();
    setLive(Math.max(stops.peek, Math.min(stops.full, held.startHeight + delta)));
  };

  const up = (event: React.PointerEvent<HTMLButtonElement>) => {
    const held = drag.current;
    drag.current = null;
    if (!held) return;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (!held.moved) {
      // A tap. The click handler would fire too, so this is the only place it
      // is handled — see the empty onClick below.
      setLive(null);
      cycle();
      return;
    }

    const settled = sheet.current?.offsetHeight ?? held.startHeight;
    setLive(null);
    onSnap(nearest(settled));
  };

  return (
    <section
      ref={sheet}
      /* A live height is only ever set while a finger is moving, so it is also
         the answer to "is this being dragged" — and reading the ref here
         instead is a render that depends on something React did not cause. */
      className={`sheet snap-${snap}${live === null ? "" : " dragging"}`}
      style={live === null ? undefined : ({ "--sheet-live": `${live}px` } as CSSProperties)}
      aria-label="Route details"
    >
      <button
        type="button"
        className="grab"
        aria-label={LABEL[snap]}
        aria-expanded={snap !== "peek"}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { drag.current = null; setLive(null); }}
        /* Keyboard and assistive tech never send pointer events, so the click
           handler is what serves them; a mouse tap is already handled above and
           would otherwise cycle twice. */
        onClick={(event) => { if (event.detail === 0) cycle(); }}
      />

      <div className="sheet-peek">{peek}</div>

      <div className="sheet-body">{children}</div>

      {tabs}
    </section>
  );
}
