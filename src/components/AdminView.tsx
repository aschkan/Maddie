"use client";

/**
 * `/admin` — where the study team adds what it finds: a new marked place, a
 * newer Pointer export, a new interview. One password (`ADMIN_PASSWORD`, from
 * the platform's 🔑 Fix secrets; the seed prints it), one signed cookie.
 *
 * Destructive buttons ask twice ON THE PAGE — never `window.confirm()`, which
 * mobile Safari can switch off for good, turning every delete into a silent
 * no-op.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import ReportCard from "@/components/ReportCard";
import { useInterviews } from "@/components/useInterviews";
import { clock, type Interview } from "@/lib/interviews";
import type { LatLng } from "@/lib/osrm";
import { ADJUSTMENTS, AGE_BANDS, POINTER_CREDIT } from "@/lib/pointer";
import { REPORT_TYPES, SOURCE_LABEL, WHEN_OPTIONS, type Report, type ReportType, type When } from "@/lib/reports";

const AdminMap = dynamic(() => import("@/components/AdminMap"), {
  ssr: false,
  loading: () => <div className="map admin-map map-loading">Loading the map…</div>,
});

type Tab = "places" | "import" | "interviews";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `The server answered ${response.status}.`);
  return body;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ── sign in ─────────────────────────────────────────────────────────── */

export default function AdminView() {
  const [state, setState] = useState<{ configured: boolean; signedIn: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("places");

  const check = useCallback(() => {
    void (async () => {
      try {
        setState(await call<{ configured: boolean; signedIn: boolean }>("/api/admin/session"));
      } catch {
        setState({ configured: true, signedIn: false });
      }
    })();
  }, []);
  useEffect(check, [check]);

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE" });
    check();
  }

  return (
    <main className="research-page admin">
      <header className="research-top">
        <Link href="/" className="link-quiet">← Back to the boards</Link>
        {state?.signedIn && <>{" · "}<Link href="/research" className="link-quiet">Interviews (read)</Link></>}
        <h1>Maddie admin</h1>
        <p className="hint">Add what you find: marked places, a newer Pointer export, interviews. Everything here is real
          data and goes straight into the shared database on both servers.</p>
      </header>

      {!state && <p className="hint">Checking…</p>}
      {state && !state.configured && (
        <p className="error">
          The admin area is not configured on this server: <code>ADMIN_PASSWORD</code> and <code>SESSION_SECRET</code> are
          not set. Press 🔑 Fix secrets on Maddie&apos;s card in the platform panel, then restart Maddie.
        </p>
      )}
      {state?.configured && !state.signedIn && <SignIn onDone={check} />}
      {state?.signedIn && (
        <>
          <nav className="admin-tabs" aria-label="Admin sections">
            {(["places", "import", "interviews"] as Tab[]).map((id) => (
              <button key={id} type="button" className={tab === id ? "on" : undefined} onClick={() => setTab(id)}>
                {id === "places" ? "Marked places" : id === "import" ? "Import Pointer export" : "Interviews"}
              </button>
            ))}
            <button type="button" className="btn-ghost" onClick={() => void signOut()}>Sign out</button>
          </nav>
          {tab === "places" && <Places />}
          {tab === "import" && <Import />}
          {tab === "interviews" && <Interviews />}
        </>
      )}
    </main>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await call("/api/admin/session", json("POST", { password }));
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>User<input value="admin" readOnly /></label>
      <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></label>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="btn" disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

/* ── places ──────────────────────────────────────────────────────────── */

interface Draft {
  id: string | null;
  point: LatLng | null;
  place: string;
  date: string;
  reasons: ReportType[];
  when: When | "";
  adjustments: string[];
  age: string;
  note: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY: Draft = { id: null, point: null, place: "", date: today(), reasons: [], when: "", adjustments: [], age: "", note: "" };

function draftOf(report: Report): Draft {
  return {
    id: report.id,
    point: report.point,
    place: report.place ?? "",
    date: report.at.slice(0, 10),
    reasons: report.reasons ?? (report.category === "other" ? [] : [report.category]),
    when: report.when ?? "",
    adjustments: report.adjustments ?? [],
    age: report.age ?? "",
    note: report.note ?? "",
  };
}

function Places() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [skip, setSkip] = useState(0);
  const [list, setList] = useState<{ reports: Report[]; total: number; counts: Record<string, number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const LIMIT = 25;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const query = new URLSearchParams({ q, source, skip: String(skip), limit: String(LIMIT) });
        const response = await fetch(`/api/admin/reports?${query}`, { signal: controller.signal });
        const body = (await response.json()) as { reports: Report[]; total: number; counts: Record<string, number>; error?: string };
        if (!response.ok) throw new Error(body.error ?? String(response.status));
        setList(body);
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Could not load the places.");
      }
    })();
    return () => controller.abort();
  }, [q, source, skip, round]);

  async function remove(id: string) {
    if (armed !== id) {
      setArmed(id);
      return;
    }
    setArmed(null);
    try {
      await call(`/api/admin/reports?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setRound((n) => n + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete.");
    }
  }

  return (
    <section className="admin-section">
      {draft ? (
        <PlaceForm draft={draft} onCancel={() => setDraft(null)} onSaved={() => { setDraft(null); setRound((n) => n + 1); }} />
      ) : (
        <button type="button" className="btn" onClick={() => setDraft({ ...EMPTY, date: today() })}>+ Add a marked place</button>
      )}

      <div className="admin-filters">
        <input type="search" placeholder="Search town, story or id" value={q} onChange={(e) => { setQ(e.target.value); setSkip(0); }} />
        <select value={source} onChange={(e) => { setSource(e.target.value); setSkip(0); }} aria-label="Source">
          <option value="">Every source</option>
          <option value="pointer">Pointer survey</option>
          <option value="admin">Study team</option>
          <option value="community">Community</option>
        </select>
      </div>
      {list && (
        <p className="hint">
          {list.total.toLocaleString("en-GB")} match · in the database:{" "}
          {Object.entries(list.counts).map(([key, n]) => `${n.toLocaleString("en-GB")} ${SOURCE_LABEL[key as Report["source"]] ?? key}`).join(", ")}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <ul className="admin-list">
        {list?.reports.map((report) => (
          <li key={report.id}>
            <ReportCard report={report} />
            <div className="row">
              <button type="button" className="btn-small" onClick={() => setDraft(draftOf(report))}>Edit</button>
              <button type="button" className={`btn-small${armed === report.id ? " danger" : ""}`} onClick={() => void remove(report.id)}>
                {armed === report.id ? "Tap again to delete" : "Delete"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {list && list.total > LIMIT && (
        <div className="row">
          <button type="button" className="btn-ghost" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - LIMIT))}>← Newer</button>
          <span className="hint">{skip + 1}–{Math.min(skip + LIMIT, list.total)} of {list.total.toLocaleString("en-GB")}</span>
          <button type="button" className="btn-ghost" disabled={skip + LIMIT >= list.total} onClick={() => setSkip(skip + LIMIT)}>Older →</button>
        </div>
      )}
    </section>
  );
}

function PlaceForm({ draft: initial, onCancel, onSaved }: { draft: Draft; onCancel: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [coords, setCoords] = useState(initial.point ? `${initial.point.lat}, ${initial.point.lng}` : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  function typed(text: string) {
    setCoords(text);
    const match = text.match(/(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)/);
    if (match) setDraft((d) => ({ ...d, point: { lat: Number(match[1]), lng: Number(match[2]) } }));
  }
  function picked(point: LatLng) {
    setDraft((d) => ({ ...d, point }));
    setCoords(`${point.lat}, ${point.lng}`);
  }

  async function save() {
    if (!draft.point) {
      setError("Put the place on the map (click it, or paste its coordinates).");
      return;
    }
    setBusy(true);
    setError(null);
    const report = {
      id: draft.id ?? undefined,
      point: draft.point,
      at: new Date(`${draft.date}T12:00:00Z`).toISOString(),
      reasons: REPORT_TYPES.map((t) => t.id).filter((id) => draft.reasons.includes(id)),
      ...(draft.when ? { when: draft.when } : {}),
      adjustments: draft.adjustments,
      ...(draft.age ? { age: draft.age } : {}),
      ...(draft.place.trim() ? { place: draft.place.trim() } : {}),
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    };
    try {
      await call("/api/admin/reports", json(draft.id ? "PUT" : "POST", { report }));
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <h2>{draft.id ? "Correct this place" : "Add a marked place"}</h2>
      <div className="map-wrap admin-map-wrap"><AdminMap point={draft.point} onPick={picked} /></div>
      <label>Coordinates (click the map, or paste &ldquo;lat, lng&rdquo;)
        <input value={coords} onChange={(e) => typed(e.target.value)} placeholder="52.0907, 5.1214" inputMode="decimal" />
      </label>
      <label>Town / place name<input value={draft.place} onChange={(e) => setDraft({ ...draft, place: e.target.value })} placeholder="Utrecht" /></label>
      <label>Date reported<input type="date" value={draft.date} max={today()} onChange={(e) => setDraft({ ...draft, date: e.target.value || today() })} /></label>
      <fieldset>
        <legend>Why the place is marked (any that apply)</legend>
        {REPORT_TYPES.filter((t) => t.id !== "other").map((type) => (
          <label key={type.id} className="check">
            <input type="checkbox" checked={draft.reasons.includes(type.id)} onChange={() => setDraft({ ...draft, reasons: toggle(draft.reasons, type.id) })} />
            <span>{type.label}</span>
          </label>
        ))}
      </fieldset>
      <label>When
        <select value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value as When | "" })}>
          <option value="">Not given</option>
          {WHEN_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <fieldset>
        <legend>How the person adapts (any that apply)</legend>
        {ADJUSTMENTS.map((a) => (
          <label key={a.id} className="check">
            <input type="checkbox" checked={draft.adjustments.includes(a.id)} onChange={() => setDraft({ ...draft, adjustments: toggle(draft.adjustments, a.id) })} />
            <span>{a.label}</span>
          </label>
        ))}
      </fieldset>
      <label>Age band
        <select value={draft.age} onChange={(e) => setDraft({ ...draft, age: e.target.value })}>
          <option value="">Not given</option>
          {AGE_BANDS.map((band) => <option key={band} value={band}>{band}</option>)}
        </select>
      </label>
      <label>Story (only with the person&apos;s consent to share)
        <textarea value={draft.note} maxLength={4000} rows={4} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

/* ── import ──────────────────────────────────────────────────────────── */

interface ImportResult { read: number; inserted: number; updated: number; skippedTotal: number; skipped: { line: number; why: string }[] }

function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [exportedAt, setExportedAt] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const query = new URLSearchParams({ version, exportedAt });
      setResult(await call<ImportResult>(`/api/admin/import?${query}`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text(),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-section">
      <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void run(); }}>
        <h2>Import a Pointer export</h2>
        <p className="hint">
          The <code>Pointer-onveilige-plekken-*.csv</code> file Pointer sends. It is read into the database and not kept;
          places already there are updated, new ones added, and places missing from the new file are left alone.
          Credit wherever it is shown: {POINTER_CREDIT}.
        </p>
        <label>Export file<input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label>Export date (from <code>versie.txt</code>)<input type="date" value={exportedAt} onChange={(e) => setExportedAt(e.target.value)} /></label>
        <label>Export hash (from <code>versie.txt</code>, optional)<input value={version} onChange={(e) => setVersion(e.target.value)} /></label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn" disabled={!file || busy}>{busy ? "Importing… (a minute for 18k rows)" : "Import"}</button>
      </form>
      {result && (
        <div className="admin-result">
          <p><b>{result.read.toLocaleString("en-GB")}</b> places read · {result.inserted.toLocaleString("en-GB")} new · {result.updated.toLocaleString("en-GB")} changed</p>
          {result.skippedTotal > 0 && (
            <>
              <p className="hint">{result.skippedTotal} row(s) skipped:</p>
              <ul>{result.skipped.map((s) => <li key={s.line}>line {s.line}: {s.why}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ── interviews ──────────────────────────────────────────────────────── */

interface InterviewDraft {
  id: string | null;
  label: string;
  participant: string;
  conductedAt: string;
  interviewer: string;
  notes: string;
  text: string;
  whisper: string;
  fileName: string;
}

function interviewDraft(interview: Interview | null): InterviewDraft {
  return {
    id: interview?.id ?? null,
    label: interview?.label ?? "",
    participant: interview?.participant ?? "",
    conductedAt: interview?.conductedAt?.slice(0, 10) ?? "",
    interviewer: interview?.interviewer ?? "",
    notes: interview?.notes ?? "",
    text: "",
    whisper: "",
    fileName: "",
  };
}

function Interviews() {
  const store = useInterviews();
  const [draft, setDraft] = useState<InterviewDraft | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await call("/api/admin/interviews", json(draft.id ? "PUT" : "POST", {
        id: draft.id,
        label: draft.label,
        participant: draft.participant,
        conductedAt: draft.conductedAt ? new Date(`${draft.conductedAt}T12:00:00Z`).toISOString() : "",
        interviewer: draft.interviewer,
        notes: draft.notes,
        ...(draft.whisper ? { whisper: draft.whisper } : draft.text.trim() ? { text: draft.text } : {}),
      }));
      setDraft(null);
      store.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (armed !== id) {
      setArmed(id);
      return;
    }
    setArmed(null);
    try {
      await call(`/api/admin/interviews?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      store.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete.");
    }
  }

  async function pickFile(file: File | undefined) {
    if (!file || !draft) return;
    const text = await file.text();
    if (file.name.toLowerCase().endsWith(".json")) setDraft({ ...draft, whisper: text, text: "", fileName: file.name });
    else setDraft({ ...draft, text, whisper: "", fileName: file.name });
  }

  return (
    <section className="admin-section">
      {draft ? (
        <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <h2>{draft.id ? "Correct this interview" : "Add an interview"}</h2>
          <label>Label<input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Interview 5" /></label>
          <label>Participant (name or pseudonym — team only)<input value={draft.participant} onChange={(e) => setDraft({ ...draft, participant: e.target.value })} /></label>
          <label>Date held<input type="date" value={draft.conductedAt} onChange={(e) => setDraft({ ...draft, conductedAt: e.target.value })} /></label>
          <label>Interviewer<input value={draft.interviewer} onChange={(e) => setDraft({ ...draft, interviewer: e.target.value })} /></label>
          <label>
            {draft.id ? "Replace the transcript (optional)" : "Transcript"} — the transcription&apos;s <code>.json</code> (keeps timings) or a <code>.txt</code>
            <input type="file" accept=".json,.txt,application/json,text/plain" onChange={(e) => void pickFile(e.target.files?.[0])} />
          </label>
          {draft.fileName && <p className="hint">Loaded {draft.fileName}.</p>}
          {!draft.whisper && (
            <label>…or paste it, one line per turn
              <textarea rows={6} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            </label>
          )}
          <label>Team notes about the session<textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
            <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn" onClick={() => setDraft(interviewDraft(null))}>+ Add an interview</button>
      )}
      {store.error && <p className="error">{store.error}</p>}
      {!draft && error && <p className="error">{error}</p>}
      <ul className="admin-list">
        {store.interviews.map((interview) => (
          <li key={interview.id}>
            <div>
              <b>{interview.code} · {interview.label}</b>{interview.participant ? ` — ${interview.participant}` : ""}
              <p className="hint">
                {interview.segments.length} lines
                {interview.durationSec ? ` · ${clock(interview.durationSec)}` : ""}
                {interview.conductedAt ? ` · held ${interview.conductedAt.slice(0, 10)}` : " · date not recorded"}
              </p>
            </div>
            <div className="row">
              <Link className="btn-small" href="/research">Read</Link>
              <button type="button" className="btn-small" onClick={() => setDraft(interviewDraft(interview))}>Edit</button>
              <button type="button" className={`btn-small${armed === interview.id ? " danger" : ""}`} onClick={() => void remove(interview.id)}>
                {armed === interview.id ? "Tap again to delete" : "Delete"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
