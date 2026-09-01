"use client";

import { useMemo, useState } from "react";
import { MapView } from "@/components/MapView";
import { Card, DimensionList, Field, GapNotice, ScoreBadge, buttonClass, inputClass } from "@/components/ui";
import { DEFAULT_CENTRE, fromLocalInput, getJson, metres, minutes, postJson, toLocalInput } from "@/lib/client";
import type { RouteAssessment, RouteOutcome, SegmentScore } from "@/lib/scoring/route";
import type { GeoPlace } from "@/lib/sources/pdok";

interface GeocodeBody {
  status: string;
  places: GeoPlace[];
  note: string | null;
}

const SEGMENT_COLOUR: Record<SegmentScore["band"], string> = {
  good: "#4ade80",
  fair: "#a3e635",
  caution: "#fbbf24",
  poor: "#f87171",
  unknown: "#6b7280",
};

export default function RoutePage() {
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [from, setFrom] = useState(DEFAULT_CENTRE);
  const [to, setTo] = useState({ lat: DEFAULT_CENTRE.lat + 0.012, lng: DEFAULT_CENTRE.lng + 0.012 });
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [outcome, setOutcome] = useState<RouteOutcome | null>(null);
  const [chosen, setChosen] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [picking, setPicking] = useState<"from" | "to">("from");

  const route: RouteAssessment | null = outcome?.routes[chosen] ?? null;

  const lines = useMemo(() => {
    if (route === null) return [];
    return route.segments.map((segment) => ({
      points: [segment.start, segment.end],
      colour: SEGMENT_COLOUR[segment.band],
      width: 6,
    }));
  }, [route]);

  const locate = async (text: string, set: (point: { lat: number; lng: number }) => void): Promise<void> => {
    if (text.trim() === "") return;
    const { body } = await getJson<GeocodeBody>(`/api/geocode?q=${encodeURIComponent(text)}`);
    const first = body.places[0];
    if (first !== undefined) set(first.point);
    else setFailure(body.note ?? "That address could not be found.");
  };

  const plan = async (): Promise<void> => {
    setLoading(true);
    setFailure(null);
    try {
      const { body } = await postJson<RouteOutcome>("/api/route", {
        from,
        to,
        at: fromLocalInput(when).toISOString(),
      });
      setOutcome(body);
      setChosen(0);
      if (body.routes.length === 0 && body.note !== null) setFailure(body.note);
    } catch {
      setFailure("The routing service could not be reached, so no route was produced. This is not a claim that no route exists.");
    } finally {
      setLoading(false);
    }
  };

  const worst = route === null || route.worstSegmentIndex === null ? null : route.segments[route.worstSegmentIndex] ?? null;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">The safest way, not the quickest</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Each stretch is scored on its own. A walk that is fine for 900 metres and frightening for the last 200 is
          not a single number, and the last 200 metres are the answer.
        </p>
      </header>

      <Card className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <Field label="From">
            <div className="flex gap-2">
              <input
                className={inputClass}
                placeholder="address, or click the map"
                value={fromText}
                onChange={(event) => setFromText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void locate(fromText, setFrom);
                }}
              />
              <button
                type="button"
                onClick={() => setPicking("from")}
                className={`rounded-lg border px-3 text-xs ${picking === "from" ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-line)]"}`}
              >
                Pick
              </button>
            </div>
          </Field>
          <Field label="To">
            <div className="flex gap-2">
              <input
                className={inputClass}
                placeholder="address, or click the map"
                value={toText}
                onChange={(event) => setToText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void locate(toText, setTo);
                }}
              />
              <button
                type="button"
                onClick={() => setPicking("to")}
                className={`rounded-lg border px-3 text-xs ${picking === "to" ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-line)]"}`}
              >
                Pick
              </button>
            </div>
          </Field>
          <Field label="Leaving at">
            <input type="datetime-local" className={inputClass} value={when} onChange={(event) => setWhen(event.target.value)} />
          </Field>
          <div className="flex items-end">
            <button type="button" className={buttonClass} onClick={() => void plan()} disabled={loading}>
              {loading ? "Scoring…" : "Score the walk"}
            </button>
          </div>
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          Clicking the map sets the <strong>{picking}</strong> point.
        </p>
      </Card>

      <MapView
        centre={from}
        markers={[
          { lat: from.lat, lng: from.lng, colour: "#ffffff" },
          { lat: to.lat, lng: to.lng, colour: "#b98cff" },
        ]}
        lines={lines}
        onPick={(point) => (picking === "from" ? setFrom(point) : setTo(point))}
        height="24rem"
      />

      {failure !== null ? <GapNotice gaps={[failure]} title="No route was produced" /> : null}

      {outcome !== null && outcome.routes.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {outcome.routes.map((option, index) => (
            <button
              key={index}
              type="button"
              onClick={() => setChosen(index)}
              className={`rounded-full border px-3 py-1.5 text-xs ${index === chosen ? "border-[var(--color-accent)] text-[var(--color-accent)]" : "border-[var(--color-line)] text-[var(--color-muted)]"}`}
            >
              {option.score === null ? "unscored" : `${option.score}`} · {metres(option.distanceMetres)} ·{" "}
              {minutes(option.durationSeconds)}
            </button>
          ))}
        </div>
      ) : null}

      {route !== null ? (
        <>
          <Card className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <ScoreBadge score={route.score} confidence={route.confidence} band={route.band} size="lg" />
              <div className="text-right text-sm">
                <p>
                  {metres(route.distanceMetres)} · {minutes(route.durationSeconds)}
                </p>
                <p className="text-xs text-[var(--color-muted)]">
                  {route.segments.length} stretches scored for{" "}
                  {new Date(outcome!.at).toLocaleString(undefined, { timeStyle: "short", dateStyle: "medium" })}
                </p>
              </div>
            </div>
            {worst !== null ? (
              <div className="rounded-lg border border-[var(--color-caution)]/40 bg-[var(--color-caution)]/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-caution)]">
                  The stretch to know about
                </p>
                <p className="mt-1 text-sm">
                  Stretch {worst.index + 1} of {route.segments.length}
                  {worst.areaName === null ? "" : `, in ${worst.areaName}`} — {metres(worst.lengthMetres)}, scoring{" "}
                  {worst.score ?? "—"}.
                </p>
              </div>
            ) : null}
          </Card>

          <ol className="space-y-3">
            {route.segments.map((segment) => (
              <SegmentRow key={segment.index} segment={segment} total={route.segments.length} />
            ))}
          </ol>

          <GapNotice gaps={route.gaps} />
        </>
      ) : null}
    </div>
  );
}

function SegmentRow({ segment, total }: { segment: SegmentScore; total: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-4 p-4 text-left">
        <ScoreBadge score={segment.score} confidence={segment.confidence} band={segment.band} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Stretch {segment.index + 1} of {total}
            {segment.areaName === null ? "" : ` · ${segment.areaName}`}
          </p>
          <p className="text-xs text-[var(--color-muted)]">{metres(segment.lengthMetres)}</p>
        </div>
        <span className="text-xs text-[var(--color-muted)]">{open ? "Hide" : "Why"}</span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-[var(--color-line)] px-4 py-3">
          <DimensionList dimensions={segment.dimensions} />
          <GapNotice gaps={segment.gaps} />
        </div>
      ) : null}
    </li>
  );
}
