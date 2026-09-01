"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapView } from "@/components/MapView";
import { Card, Field, GapNotice, buttonClass, inputClass } from "@/components/ui";
import { DEFAULT_CENTRE, getJson, postJson } from "@/lib/client";
import { REPORT_CATEGORY_LABELS, type CommunityReport, type ReportCategory } from "@/lib/domain";

interface ReportsBody {
  measured: boolean;
  reports?: Array<Omit<CommunityReport, "anonHash">>;
  total?: number;
  last90Days?: number;
  note?: string;
}

interface PostBody {
  report?: Omit<CommunityReport, "anonHash">;
  moderated?: boolean;
  note?: string | null;
  message?: string;
}

const CATEGORIES = Object.keys(REPORT_CATEGORY_LABELS) as ReportCategory[];

export default function ReportPage() {
  const [centre, setCentre] = useState(DEFAULT_CENTRE);
  const [category, setCategory] = useState<ReportCategory>("feltUnsafe");
  const [hour, setHour] = useState<number | null>(new Date().getHours());
  const [text, setText] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [nearby, setNearby] = useState<ReportsBody | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const { body } = await getJson<ReportsBody>(`/api/reports?lat=${centre.lat}&lng=${centre.lng}&radiusMetres=1500`);
      setNearby(body);
    } catch {
      setNearby({ measured: false, note: "Reports could not be read, so none are shown. That is a gap, not an empty map." });
    }
  }, [centre.lat, centre.lng]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const submit = async (): Promise<void> => {
    setSending(true);
    setStatus(null);
    try {
      const { ok, body } = await postJson<PostBody>("/api/reports", {
        lat: centre.lat,
        lng: centre.lng,
        category,
        hour,
        text,
        placeName,
        contactBack: false,
      });
      if (!ok) {
        setStatus(body.message ?? "That could not be saved.");
      } else {
        setStatus(
          body.report?.status === "held"
            ? "Thank you. This one is held for a person to read before it appears."
            : "Thank you. It is on the map.",
        );
        setText("");
        await load();
      }
    } catch {
      setStatus("The server could not be reached, so nothing was saved. Nothing was lost either — try again.");
    } finally {
      setSending(false);
    }
  };

  const markers = useMemo(
    () => [
      { lat: centre.lat, lng: centre.lng, colour: "#b98cff" },
      ...(nearby?.reports ?? []).map((report) => ({ lat: report.lat, lng: report.lng, colour: "#f87171" })),
    ],
    [centre, nearby],
  );

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">What happened, and where</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Anonymous. Nothing identifying is asked for or kept — reports are counted against a salted hash so the same
          person cannot flood the map, and that hash never leaves the server.
        </p>
      </header>

      <MapView centre={centre} markers={markers} onPick={setCentre} />

      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="What kind of thing">
            <select
              className={inputClass}
              value={category}
              onChange={(event) => setCategory(event.target.value as ReportCategory)}
            >
              {CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {REPORT_CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Roughly what hour">
            <select
              className={inputClass}
              value={hour === null ? "" : String(hour)}
              onChange={(event) => setHour(event.target.value === "" ? null : Number(event.target.value))}
            >
              <option value="">Rather not say</option>
              {Array.from({ length: 24 }, (_, index) => (
                <option key={index} value={index}>
                  {String(index).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Where (optional)">
          <input
            className={inputClass}
            placeholder="the name of the street or place"
            value={placeName}
            onChange={(event) => setPlaceName(event.target.value)}
          />
        </Field>
        <Field label="In your own words (optional)">
          <textarea
            className={`${inputClass} min-h-28`}
            placeholder="Say as much or as little as you want."
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3">
          <button type="button" className={buttonClass} onClick={() => void submit()} disabled={sending}>
            {sending ? "Sending…" : "Add this report"}
          </button>
          {status !== null ? <p className="text-xs text-[var(--color-muted)]">{status}</p> : null}
        </div>
      </Card>

      {nearby !== null && !nearby.measured ? (
        <GapNotice gaps={[nearby.note ?? "Reports could not be read."]} title="Nothing was read" />
      ) : null}

      {nearby?.measured === true ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            {nearby.total ?? 0} reports within 1.5 km · {nearby.last90Days ?? 0} in the last 90 days
          </h2>
          {(nearby.reports ?? []).length === 0 ? (
            <Card>
              <p className="text-sm">
                Nobody has reported anything here yet. That is not the same as nothing having happened — it is only
                what has been written down.
              </p>
            </Card>
          ) : (
            <ul className="space-y-2">
              {(nearby.reports ?? [])
                .slice()
                .reverse()
                .map((report) => (
                  <li key={report.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)] p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{REPORT_CATEGORY_LABELS[report.category]}</span>
                      <span className="text-xs text-[var(--color-muted)]">
                        {new Date(report.createdAt).toLocaleDateString()}
                        {report.hour === null ? "" : ` · around ${String(report.hour).padStart(2, "0")}:00`}
                      </span>
                    </div>
                    {report.placeName !== "" ? (
                      <p className="mt-0.5 text-xs text-[var(--color-muted)]">{report.placeName}</p>
                    ) : null}
                    {report.text !== "" ? <p className="mt-2 text-sm leading-relaxed">{report.text}</p> : null}
                  </li>
                ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
