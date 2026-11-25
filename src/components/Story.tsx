"use client";

/**
 * A respondent's story, read IN the app: English first, the original one tap
 * away. Meeting of 25 Nov 2026 — "can you do it in a snippet inside the
 * application so we don't have to go to another page … you can even hide the
 * original text."
 *
 * The translation comes from `/api/translate` (the server's model). Each text
 * is asked for once per page load and remembered. If the model cannot answer,
 * the original is shown with the Google Translate link — the old behaviour —
 * so a failure never hides the story.
 */

import { useEffect, useState } from "react";

const memo = new Map<string, Promise<string | null>>();

function translated(text: string): Promise<string | null> {
  let hit = memo.get(text);
  if (!hit) {
    hit = fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then(async (response) => (response.ok ? ((await response.json()) as { text?: string | null }).text ?? null : null))
      .catch(() => null);
    memo.set(text, hit);
    // A failure is not remembered: the next look may get through.
    void hit.then((value) => { if (value === null) memo.delete(text); });
  }
  return hit;
}

/** Google Translate, as the fallback when the in-app translation fails. */
export function translateLink(text: string): string {
  return `https://translate.google.com/?sl=auto&tl=en&op=translate&text=${encodeURIComponent(text.slice(0, 1800))}`;
}

export default function Story({ text }: { text: string }) {
  const [english, setEnglish] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "done" | "failed">("loading");
  const [original, setOriginal] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      setState("loading");
      const out = await translated(text);
      if (!live) return;
      setEnglish(out);
      setState(out ? "done" : "failed");
    })();
    return () => { live = false; };
  }, [text]);

  const same = english !== null && english.trim() === text.trim();
  if (state === "failed") {
    return (
      <span className="story">
        <q className="narrative">{text}</q>
        <a className="translate" href={translateLink(text)} target="_blank" rel="noreferrer">Translate on Google ↗</a>
      </span>
    );
  }
  return (
    <span className="story">
      <q className="narrative">{state === "loading" ? text : original || same ? text : english}</q>
      {state === "loading" && <small className="muted">Translating to English…</small>}
      {state === "done" && !same && (
        <button type="button" className="link translate" onClick={() => setOriginal(!original)}>
          {original ? "Show English" : "Show original (as written)"}
        </button>
      )}
      {state === "done" && !same && !original && <small className="muted">Translated in the app — may contain errors.</small>}
    </span>
  );
}
