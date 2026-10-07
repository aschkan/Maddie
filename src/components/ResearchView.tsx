"use client";

/**
 * `/research` — the interviews, for the people running the study.
 *
 * This was a fifth tab on the map. It is a page of its own now because it is
 * not part of the tool a participant is shown: the supervisor's organisation
 * of the map is four tabs, one task each, all about the walk in front of you,
 * and "what the cohort said" is not one of them. Putting it on the participant's
 * tab bar also put the study's own data one tap away from the people taking
 * part in it.
 *
 * Nothing about the panel changed — same component, same read-only API, same
 * markings (`MARK_EXAMPLE_DATA`) — only where it lives.
 */

import Link from "next/link";

import ResearchPanel from "@/components/ResearchPanel";
import { useInterviews } from "@/components/useInterviews";

export default function ResearchView() {
  const { interviews, backend, error, loading } = useInterviews();
  return (
    <main className="research-page">
      <header className="research-top">
        <Link href="/" className="link-quiet">← Back to the map</Link>
        <h1>Interviews</h1>
        <p className="hint">The requirements interviews behind the prototype. For the research team — not part of
          what participants are shown.</p>
      </header>
      <ResearchPanel interviews={interviews} backend={backend} error={error} loading={loading} />
    </main>
  );
}
