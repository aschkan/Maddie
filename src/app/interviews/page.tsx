"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapView } from "@/components/MapView";
import { Card, GapNotice } from "@/components/ui";
import { DEFAULT_CENTRE, getJson } from "@/lib/client";
import type { Interview } from "@/lib/domain";

interface InterviewsBody {
  total: number;
  interviews: Interview[];
}

export default function InterviewsPage() {
  const [centre, setCentre] = useState(DEFAULT_CENTRE);
  const [data, setData] = useState<InterviewsBody | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { body } = await getJson<InterviewsBody>("/api/interviews");
      setData(body);
    } catch {
      setFailure("The interviews could not be read, so none are shown. That is a gap, not an empty archive.");
    }
  }, []);

  useEffect(() => {
    // Wrapped so the setState inside `load` is unambiguously after an await:
    // an effect that sets state synchronously triggers a cascading render.
    void (async () => {
      await load();
    })();
  }, [load]);

  const markers = useMemo(
    () => (data?.interviews ?? []).map((interview) => ({ lat: interview.lat, lng: interview.lng, colour: "#b98cff" })),
    [data],
  );

  const unanalysed = (data?.interviews ?? []).filter((interview) => !interview.analysed).length;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">What women said</h1>
        <p className="text-sm text-[var(--color-muted)]">
          Research interviews, tied to the places they are about. Transcripts are given in confidence and are not
          served here — which is one of the reasons the model that reads them runs on the local network.
        </p>
      </header>

      <MapView centre={centre} markers={markers} onPick={setCentre} height="18rem" />

      {failure !== null ? <GapNotice gaps={[failure]} title="Nothing was read" /> : null}

      {unanalysed > 0 ? (
        <GapNotice
          gaps={[
            `${unanalysed} interviews are stored without themes or a summary, because no model was available when they were added. They were kept as they are rather than given invented ones.`,
          ]}
          title="Partly unanalysed"
        />
      ) : null}

      {data !== null && data.interviews.length === 0 ? (
        <Card>
          <p className="text-sm">
            No interviews have been added yet. An operator adds them with a POST to{" "}
            <code className="text-xs">/api/interviews</code> and the operator token.
          </p>
        </Card>
      ) : null}

      <ul className="space-y-3">
        {(data?.interviews ?? []).map((interview) => (
          <li key={interview.id} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-ink-soft)]">
            <button
              type="button"
              className="w-full p-4 text-left"
              onClick={() => {
                setSelected(selected === interview.id ? null : interview.id);
                setCentre({ lat: interview.lat, lng: interview.lng });
              }}
            >
              <p className="text-sm font-medium">{interview.title}</p>
              <p className="text-xs text-[var(--color-muted)]">
                {interview.pseudonym === "" ? "Anonymous" : interview.pseudonym}
                {interview.locationLabel === "" ? "" : ` · ${interview.locationLabel}`} ·{" "}
                {new Date(interview.createdAt).toLocaleDateString()}
              </p>
              {interview.themes.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {interview.themes.map((theme) => (
                    <span
                      key={theme}
                      className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
                    >
                      {theme}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
            {selected === interview.id ? (
              <div className="border-t border-[var(--color-line)] px-4 py-3">
                {interview.summary === "" ? (
                  <p className="text-xs text-[var(--color-muted)]">
                    This interview has no summary: no model was available when it was added, and one was not invented.
                  </p>
                ) : (
                  <p className="text-sm leading-relaxed">{interview.summary}</p>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
