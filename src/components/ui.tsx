import type { DimensionScore } from "@/lib/scoring/dimensions";
import type { SafetyBand } from "@/lib/scoring/assess";

const BAND_COLOUR: Record<SafetyBand, string> = {
  good: "var(--color-good)",
  fair: "var(--color-fair)",
  caution: "var(--color-caution)",
  poor: "var(--color-poor)",
  unknown: "var(--color-unknown)",
};

const BAND_WORD: Record<SafetyBand, string> = {
  good: "Looks good",
  fair: "Mixed",
  caution: "Take care",
  poor: "Poor",
  unknown: "Not enough measured",
};

export function ScoreBadge({
  score,
  confidence,
  band,
  size = "md",
}: {
  score: number | null;
  confidence: number;
  band: SafetyBand;
  size?: "sm" | "md" | "lg";
}) {
  const dimension = size === "lg" ? "h-24 w-24 text-3xl" : size === "sm" ? "h-11 w-11 text-sm" : "h-16 w-16 text-xl";
  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex ${dimension} shrink-0 items-center justify-center rounded-full border-2 font-semibold tabular-nums`}
        style={{ borderColor: BAND_COLOUR[band], color: BAND_COLOUR[band] }}
        aria-label={score === null ? "Not enough was measured to give a score" : `Safety score ${score} out of 100`}
      >
        {score === null ? "—" : score}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: BAND_COLOUR[band] }}>
          {BAND_WORD[band]}
        </p>
        <p className="text-xs text-[var(--color-muted)]">
          {score === null
            ? "No score: too little of this place could be measured."
            : `${Math.round(confidence * 100)}% of this rests on measured signals`}
        </p>
      </div>
    </div>
  );
}

/**
 * A gap is displayed as a gap. It never borrows the styling of a finding, and
 * it always says who failed to look — us.
 */
export function GapNotice({ gaps, title = "What we could not see" }: { gaps: readonly string[]; title?: string }) {
  if (gaps.length === 0) return null;
  return (
    <section className="gap-note rounded-r-lg px-4 py-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">{title}</h3>
      <ul className="mt-2 space-y-1.5">
        {gaps.map((gap) => (
          <li key={gap} className="text-xs leading-relaxed text-[var(--color-muted)]">
            {gap}
          </li>
        ))}
      </ul>
    </section>
  );
}

function barColour(score: number): string {
  if (score >= 75) return "var(--color-good)";
  if (score >= 55) return "var(--color-fair)";
  if (score >= 35) return "var(--color-caution)";
  return "var(--color-poor)";
}

export function DimensionList({ dimensions }: { dimensions: readonly DimensionScore[] }) {
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {dimensions.map((dimension) => (
        <li key={dimension.key} className="py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{dimension.label}</span>
            <span className="text-xs tabular-nums text-[var(--color-muted)]">
              {dimension.score === null ? "not measured" : `${dimension.score} · ${Math.round(dimension.confidence * 100)}% sure`}
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--color-ink-soft)]">
            {dimension.score === null ? (
              <div className="h-full w-full bg-[repeating-linear-gradient(45deg,var(--color-line),var(--color-line)_4px,transparent_4px,transparent_8px)]" />
            ) : (
              <div
                className="h-full rounded-full"
                style={{ width: `${dimension.score}%`, background: barColour(dimension.score) }}
              />
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-muted)]">{dimension.why}</p>
        </li>
      ))}
    </ul>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)] p-4 ${className}`}>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]";

export const buttonClass =
  "rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-ink)] transition hover:opacity-90 disabled:opacity-50";
