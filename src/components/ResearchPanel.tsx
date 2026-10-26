"use client";

/**
 * The interviews, as a reader: every transcript, searchable across all of
 * them, each line with the time it was said.
 *
 * What it deliberately does NOT do is summarise. Grouping what participants
 * said into themes is qualitative coding — a research step with a method — and
 * a tally made by string matching here would read as a finding while being an
 * artefact of the matcher. Search shows every line containing the words, in
 * context, and stops there.
 *
 * Real participants, under a consent form: this renders only for a signed-in
 * member of the team (`/api/interviews` answers 401 otherwise).
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import type { InterviewBackend } from "@/components/useInterviews";
import { clock, search, wordCount, type Interview } from "@/lib/interviews";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export interface ResearchPanelProps {
  interviews: Interview[];
  backend: InterviewBackend;
  error: string | null;
  loading: boolean;
  signedIn: boolean;
}

function Mark({ text, needle }: { text: string; needle: string }) {
  if (needle.length < 2) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
    parts.push(text.slice(from, at), <mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

export default function ResearchPanel({ interviews, backend, error, loading, signedIn }: ResearchPanelProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const needle = query.trim().toLowerCase();
  const hits = useMemo(() => search(interviews, query), [interviews, query]);
  const byId = useMemo(() => new Map(interviews.map((i) => [i.id, i])), [interviews]);

  if (loading) return <p className="hint">Loading the interviews…</p>;
  if (!signedIn) {
    return (
      <p className="hint">
        The interviews are the study&apos;s own data and are only shown to the team. <Link href="/admin">Sign in</Link> first.
      </p>
    );
  }
  if (error) return <p className="error">{error}</p>;
  if (backend === "none") {
    return <p className="hint">No database is configured on this server, so there are no interviews to show.</p>;
  }
  if (interviews.length === 0) {
    return <p className="hint">No interviews are in the database yet. Add one in <Link href="/admin">admin</Link>.</p>;
  }

  return (
    <div className="research">
      <label className="iv-search">
        <span className="iv-heading">Search every transcript</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. dark, Google Maps, bike"
        />
      </label>

      {needle.length >= 2 && (
        <section aria-label="Search results">
          <p className="hint">
            {hits.length === 0
              ? "No line in any transcript contains that."
              : `${hits.length}${hits.length === 500 ? "+" : ""} line${hits.length === 1 ? "" : "s"} in ${new Set(hits.map((h) => h.interviewId)).size} interview(s).`}
          </p>
          <ul className="iv-hits">
            {hits.map((hit) => {
              const interview = byId.get(hit.interviewId)!;
              return (
                <li key={`${hit.interviewId}-${hit.index}`}>
                  <button type="button" className="link" onClick={() => setOpen(hit.interviewId)}>
                    {interview.code}{hit.segment.start !== null ? ` · ${clock(hit.segment.start)}` : ""}
                  </button>{" "}
                  <Mark text={hit.segment.text} needle={needle} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <h3 className="iv-heading">{interviews.length} interview{interviews.length === 1 ? "" : "s"}</h3>
      {interviews.map((interview) => (
        <details
          key={interview.id}
          className="iv-card"
          open={open === interview.id}
          onToggle={(event) => {
            const isOpen = (event.currentTarget as HTMLDetailsElement).open;
            setOpen((current) => (isOpen ? interview.id : current === interview.id ? null : current));
          }}
        >
          <summary>
            <span className="iv-code">{interview.code}</span>
            <b>{interview.label}</b>
            {interview.participant && <span className="iv-who">{interview.participant}</span>}
            <span className="iv-who">
              {interview.durationSec ? `${Math.round(interview.durationSec / 60)} min · ` : ""}
              {wordCount(interview).toLocaleString("en-GB")} words
            </span>
          </summary>
          <dl className="iv-demo">
            <dt>Held</dt><dd>{interview.conductedAt ? DATE.format(new Date(interview.conductedAt)) : "date not recorded"}</dd>
            {interview.interviewer && <><dt>Interviewer</dt><dd>{interview.interviewer}</dd></>}
            {interview.language && <><dt>Language</dt><dd>{interview.language}</dd></>}
            <dt>Transcript</dt><dd>{interview.segments.length} lines, as transcribed — not coded</dd>
          </dl>
          {interview.notes && <p className="iv-note">{interview.notes}</p>}
          <ol className="iv-transcript">
            {interview.segments.map((segment, index) => (
              <li key={index}>
                {segment.start !== null && <time>{clock(segment.start)}</time>}
                <span><Mark text={segment.text} needle={needle} /></span>
              </li>
            ))}
          </ol>
        </details>
      ))}
    </div>
  );
}
