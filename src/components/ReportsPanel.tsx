"use client";

/**
 * The Reports tab: what people say happened, and what the police recorded.
 *
 * The supervisor drew the line between this tab and Layers: "it's a very
 * different thing to tell you 'I don't like the idea that the police station is
 * considered a safe space' and to tell you 'based on my experience, this is
 * what is going on there'." Layers is the first. This is the second — where you
 * put your own experience, and read other people's.
 *
 * Three blocks, in this order:
 *
 *   1. **Along your route** — the reports within a street of the line you
 *      chose, newest first, as stories rather than dots. One report on a whole
 *      map is invisible; three on the way you are about to walk is not.
 *   2. **Reports from people** — which categories to show, whether to narrow
 *      them to the hour you are travelling at, and adding your own.
 *   3. **Police figures** — the official counts, in their own block, with
 *      everything that makes them different said beside the switch.
 *
 * The two sources are never merged and never share a colour or a shape — see
 * CLAUDE.md § "Two crime layers, and neither of them is scored". Neither is
 * part of the route reading, and both blocks say so.
 */

import { useMemo, useState } from "react";

import type { Backend } from "@/components/useReports";
import type { LayerId } from "@/components/Legend";
import { MARK_EXAMPLE_DATA } from "@/lib/demo-mode";
import { CRIME_BAND_LABEL, type CrimeBand } from "@/lib/nl-crime";
import { CRIME_CATEGORIES, type Report } from "@/lib/reports";

const BANDS: CrimeBand[] = ["low", "medium", "high", "highest"];

interface Props {
  shown: Record<LayerId, boolean>;
  onShow: (layer: LayerId, on: boolean) => void;
  crime: string[];
  onCrime: (ids: string[]) => void;
  aroundHour: boolean;
  onAroundHour: (on: boolean) => void;
  hour: number;
  /** Reports within a street of the selected route, after the filters. */
  along: Report[];
  routeLabel: string | null;
  reportCount: number;
  hiddenReports: number;
  reportMode: boolean;
  onReportMode: (on: boolean) => void;
  reportCategory: string;
  onReportCategory: (id: string) => void;
  reportNote: string;
  onReportNote: (note: string) => void;
  exampleCount: number;
  onClearExamples: () => void;
  backend: Backend;
  reportError: string | null;
  /** In the scenario, a report added stays in this session and nowhere else. */
  scenario: boolean;
  policeCount: number;
  policePeriods: string[];
  policeError: string | null;
  policeBusy: boolean;
}

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export default function ReportsPanel({
  shown, onShow, crime, onCrime, aroundHour, onAroundHour, hour, along, routeLabel,
  reportCount, hiddenReports, reportMode, onReportMode, reportCategory, onReportCategory,
  reportNote, onReportNote, exampleCount, onClearExamples, backend, reportError, scenario,
  policeCount, policePeriods, policeError, policeBusy,
}: Props) {
  const label = useMemo(() => new Map(CRIME_CATEGORIES.map((c) => [c.id, c.label])), []);
  const [policeMore, setPoliceMore] = useState(false);
  const newest = useMemo(
    () => [...along].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    [along],
  );

  return (
    <div className="reports">
      <header className="panel-head">
        <h2>Reports</h2>
        <p className="hint">What people say happened, and what the police recorded. Shown beside the route reading,
          never inside it.</p>
      </header>

      {/* ── along your route ────────────────────────────────────────────── */}
      {routeLabel && shown.reports && (
        <section className="card">
          <h3>Along {routeLabel}</h3>
          {newest.length === 0 ? (
            <p className="hint">No reports within a street of this route{aroundHour ? ` around ${String(hour).padStart(2, "0")}:00` : ""}.
              That means nobody wrote anything down here — not that nothing happened.</p>
          ) : (
            <ul className="stories">
              {newest.slice(0, 12).map((report) => (
                <li key={report.id} className="story">
                  <span className="story-head">
                    <span className="sw sw-report" aria-hidden="true" />
                    <strong>{label.get(report.category) ?? report.category}</strong>
                    <small>{new Date(report.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })},{" "}
                      {new Date(report.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</small>
                  </span>
                  {report.note ? <span className="story-note">{report.note}</span> : <span className="story-note none">No note left.</span>}
                  {report.area && <small>{report.area}</small>}
                </li>
              ))}
            </ul>
          )}
          {newest.length > 12 && <p className="hint">and {newest.length - 12} more on the map.</p>}
        </section>
      )}

      {/* ── reports from people ─────────────────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <h3><span className="sw sw-report" aria-hidden="true" /> Reports from people</h3>
          <span className="count">{shown.reports ? reportCount : ""}</span>
          <label className="switch">
            <input type="checkbox" checked={shown.reports} onChange={(event) => onShow("reports", event.target.checked)}
                   aria-label="Show reports on the map" />
            <span aria-hidden="true" />
          </label>
        </div>

        <p className="hint">Street-level, entered by the people using the app — and the only source for harassment and
          catcalling, which are not offences anyone is charged with, so they appear in no police table. Older reports
          are drawn fainter.
          {scenario
            ? " In the study scenario, the reports were prepared for the session, and one you add stays in this session only."
            : backend === "mongo"
              ? " Saved to this instance's database; everyone using it sees them."
              : backend === "browser"
                ? " No database is configured, so a report you add stays in this browser."
                : ""}
        </p>

        {MARK_EXAMPLE_DATA && exampleCount > 0 && !scenario && (
          /* Loud, and it stays until the data is gone. Points invented by
             `npm run seed` sit on real streets; the only thing keeping them
             from being read as records of real events is that the screen says
             so everywhere they appear. */
          <div className="example-banner">
            <strong>{exampleCount} of these are example data.</strong> Generated by{" "}
            <code>npm run seed</code> so the filters can be seen working before the
            interviews exist. None of it happened. They are drawn as hollow dashed bubbles.
            <button type="button" onClick={onClearExamples}>Remove the example data</button>
          </div>
        )}

        {reportError && !scenario && <p className="error">{reportError}</p>}

        <label className="check">
          <input type="checkbox" checked={aroundHour} onChange={(event) => onAroundHour(event.target.checked)} disabled={!shown.reports} />
          Only reports around {String(hour).padStart(2, "0")}:00
          <small>Within three hours either side of the time you are travelling — what happens here at the time you will be here.</small>
        </label>

        {CRIME_CATEGORIES.map((category) => (
          <label key={category.id} className="check">
            <input
              type="checkbox"
              checked={crime.includes(category.id)}
              onChange={() => onCrime(toggle(crime, category.id))}
              disabled={!shown.reports}
            />
            {category.label}
          </label>
        ))}
        {hiddenReports > 0 && shown.reports && (
          <p className="hint">{hiddenReports} report{hiddenReports === 1 ? "" : "s"} hidden by these filters.</p>
        )}

        <div className="report-add">
          <button
            type="button"
            className={reportMode ? "primary" : ""}
            aria-pressed={reportMode}
            onClick={() => onReportMode(!reportMode)}
          >
            {reportMode ? "Tap the map to place it — or cancel" : "＋ Add a report"}
          </button>
          {reportMode && (
            <>
              <label className="field-label" htmlFor="report-category">What happened</label>
              <select id="report-category" value={reportCategory} onChange={(event) => onReportCategory(event.target.value)}>
                {CRIME_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
                ))}
              </select>
              <label className="field-label" htmlFor="report-note">A few words (optional)</label>
              <textarea
                id="report-note"
                rows={2}
                maxLength={280}
                value={reportNote}
                onChange={(event) => onReportNote(event.target.value)}
                placeholder="What would you want someone walking here to know?"
              />
            </>
          )}
        </div>
      </section>

      {/* ── police figures ──────────────────────────────────────────────── */}
      <section className="card">
        <div className="card-head">
          <h3><span className="sw sw-police" aria-hidden="true" /> Police figures</h3>
          <span className="count">{shown.police ? policeCount || "" : ""}</span>
          <label className="switch">
            <input type="checkbox" checked={shown.police} onChange={(event) => onShow("police", event.target.checked)}
                   aria-label="Show police figures on the map" />
            <span aria-hidden="true" />
          </label>
        </div>
        <p className="hint">Recorded crime from CBS, counted per neighbourhood per month — hatched over the whole
          neighbourhood, denser where more was recorded. It cannot tell one street from the next, so it never changes
          the route reading.</p>
        <div className="bands">
          {BANDS.map((band) => (
            <span key={band} className={`band band-${band}`}>{CRIME_BAND_LABEL[band]}</span>
          ))}
        </div>
        <button type="button" className="disclose" aria-expanded={policeMore} onClick={() => setPoliceMore(!policeMore)}>
          <span className="lg-info" aria-hidden="true">i</span> What these figures are, and are not
        </button>
        {policeMore && (
          <div className="how">
            <p>Live from CBS table <code>47022NED</code>: offences recorded by the police, in the police&rsquo;s own
              classification. Per neighbourhood per month is the finest grain this data has anywhere — it is not a
              map of where anything happened.</p>
            <p>More recorded offences does not make a place worse to walk through. Reporting rates, footfall and how heavily
              an area is policed all move these numbers, and a busy centre records more of everything than a quiet
              street nobody walks down.</p>
            {policePeriods.length > 0 && (
              <p>Showing {policePeriods.length} months to {policePeriods[policePeriods.length - 1]}. The most recent month
                is skipped — police figures lag, and a half-filled month reads as a sudden drop in crime.</p>
            )}
          </div>
        )}
        {policeBusy && <p className="hint">Asking CBS…</p>}
        {policeError && <p className="error">{policeError}</p>}
      </section>
    </div>
  );
}
