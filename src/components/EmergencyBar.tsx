"use client";

import { useState } from "react";

const EMERGENCY = process.env.NEXT_PUBLIC_EMERGENCY_NUMBER ?? "112";

export function EmergencyBar() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-line)] bg-[var(--color-ink)]/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <p className="text-xs text-[var(--color-muted)]">
          In immediate danger, call {EMERGENCY}. Nothing on this page is a substitute for that.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-paper)]"
          >
            {open ? "Hide" : "How to read this"}
          </button>
          <a
            href={`tel:${EMERGENCY}`}
            className="rounded-full bg-[var(--color-poor)] px-4 py-1.5 text-sm font-semibold text-[var(--color-ink)]"
          >
            {EMERGENCY}
          </a>
        </div>
      </div>
      {open ? (
        <div className="mx-auto w-full max-w-6xl px-4 pb-4 text-xs leading-relaxed text-[var(--color-muted)]">
          <p>
            Every number here is computed for a specific time, and it changes with the hour. Where a signal is
            missing, it is shown as a gap rather than folded into the score: &ldquo;we did not look&rdquo; is never
            reported as &ldquo;nothing happened here&rdquo;. Confidence tells you how much of the picture was
            actually measured.
          </p>
        </div>
      ) : null}
    </div>
  );
}
