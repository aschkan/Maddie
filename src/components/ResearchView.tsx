"use client";

/**
 * `/research` — the interview transcripts, for the people running the study.
 * Not part of the boards a participant is shown, and only readable after
 * signing in at `/admin`.
 */

import Link from "next/link";

import ResearchPanel from "@/components/ResearchPanel";
import { useInterviews } from "@/components/useInterviews";

export default function ResearchView() {
  const { interviews, backend, error, loading, signedIn } = useInterviews();
  return (
    <main className="research-page">
      <header className="research-top">
        <Link href="/" className="link-quiet">← Back to the boards</Link>
        {" · "}
        <Link href="/admin" className="link-quiet">Admin</Link>
        <h1>Interviews</h1>
        <p className="hint">The requirements interviews behind the prototype, as transcribed. For the research team —
          real participants under a consent form; do not share outside the team.</p>
      </header>
      <ResearchPanel interviews={interviews} backend={backend} error={error} loading={loading} signedIn={signedIn} />
    </main>
  );
}
