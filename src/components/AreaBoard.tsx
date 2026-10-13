"use client";

/**
 * Board 03 — one neighbourhood in detail. Opened from Explore's neighbourhood
 * list (`/area?d=<district>`). Same chart-chooser logic as the other boards:
 *
 *   counts                     → a KPI strip (counts, not scores)
 *   twelve months × type       → lines
 *   hour × weekday             → heatmap, the current hour outlined
 *   where each figure is from  → a provenance table
 *   districts against each other → ranked bars, PER KM OF ROAD so a bigger
 *                                  area is not automatically "worse"
 *
 * What stays off this screen: any colour-coded "safety" overlay, any verdict
 * label, any forecast. The line ends at the last record.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import BoardHeader from "@/components/BoardHeader";
import { Heatmap, Key, Lines, RankBars, Swatch } from "@/components/charts";
import { useEvidence } from "@/components/EvidenceProvider";
import { TYPE_INK } from "@/components/ExploreBoard";
import { districtById } from "@/lib/cities";
import { districtOf, hourOf, monthKeys, REPORT_TYPES, reportType } from "@/lib/evidence";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Monday first, as people read a week. `Date.getDay` is Sunday first. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function AreaBoard({ districtId }: { districtId: string | null }) {
  const ev = useEvidence();
  const { city } = ev;
  const [picked, setPicked] = useState<string | null>(null);
  const district = districtById(city, picked ?? districtId) ?? city.districts[0]!;
  // Read in the browser: this page is prerendered, and "now" during that
  // render is the build machine's clock.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    void (async () => setNow(new Date()))();
  }, []);

  const where = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const report of ev.reports) map.set(report.id, districtOf(city, report.point)?.id ?? null);
    return map;
  }, [ev.reports, city]);

  const here = useMemo(() => ev.reports.filter((report) => where.get(report.id) === district.id), [ev.reports, where, district.id]);
  const latest = here.reduce((max, report) => (report.at > max ? report.at : max), "");
  const months = useMemo(() => {
    const days = here.map((report) => report.at.slice(0, 10)).sort();
    return days.length ? monthKeys(days[0]!, days[days.length - 1]!) : [];
  }, [here]);

  const byType = REPORT_TYPES.map((type) => ({ ...type, count: here.filter((r) => reportType(r.category) === type.id).length }));
  const series = REPORT_TYPES.map((type) => {
    const index = new Map(months.map((key, i) => [key, i]));
    const values = new Array<number>(months.length).fill(0);
    for (const report of here) {
      const at = index.get(report.at.slice(0, 7));
      if (at !== undefined && reportType(report.category) === type.id) values[at]! += 1;
    }
    return { id: type.id, label: type.label, values, colour: TYPE_INK[type.id] };
  });
  const peak = (() => {
    const totals = months.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
    const max = Math.max(0, ...totals);
    const at = totals.indexOf(max);
    return max > 0 && months.length >= 6 ? { at, label: "Peak month" } : null;
  })();

  const grid = useMemo(() => {
    const values = WEEKDAYS.map(() => new Array<number>(24).fill(0));
    for (const report of here) {
      const weekday = (new Date(report.at).getDay() + 6) % 7;
      values[weekday]![hourOf(report)]! += 1;
    }
    return values;
  }, [here]);

  const perKm = city.districts.map((d) => ({
    id: d.id,
    label: d.name,
    value: ev.reports.filter((r) => where.get(r.id) === d.id).length / Math.max(0.1, d.roadKm),
  })).sort((a, b) => b.value - a.value);

  const exampleNote = city.figures === "example" ? " · example figure" : "";

  return (
    <main className="board area">
      <BoardHeader
        title={`${district.name} in detail`}
        kind="All records in the window · Synthetic example data"
        note={<Link href="/">← Back to {city.name} overview</Link>}
      />

      <div className="area-pick">
        {city.districts.map((d) => (
          <button key={d.id} type="button" className={d.id === district.id ? "on" : undefined} onClick={() => setPicked(d.id)}>{d.name}</button>
        ))}
      </div>

      <section className="card kpis" aria-label="Observed counts">
        <p className="kpi-title">OBSERVED COUNTS · {district.name.toUpperCase()}</p>
        <div className="kpi-row">
          {byType.map((type) => (
            <div key={type.id} className="kpi" style={{ borderLeftColor: TYPE_INK[type.id] }}>
              <b>{type.count}</b>
              <span>{type.label} reports</span>
            </div>
          ))}
          <div className="kpi"><b className="lit-ink">{district.lighting.lit}%</b><span>Streets mapped lit<small>by length{exampleNote}</small></span></div>
          <div className="kpi"><b>{district.lighting.unlit}%</b><span>Streets mapped unlit<small>by length{exampleNote}</small></span></div>
          <div className="kpi"><b className="muted">{district.lighting.unknown}%</b><span>Lighting unknown<small>missing data</small></span></div>
        </div>
      </section>

      <div className="area-grid">
        <section className="card">
          <div className="card-head"><h2>Reports over time — by type</h2></div>
          <Key items={series.map((s) => ({ swatch: <Swatch colour={s.colour} />, label: s.label }))} />
          <Lines
            labels={months.map((key) => `${MONTHS[Number(key.slice(5, 7)) - 1]}${months.length > 12 ? ` ${key.slice(2, 4)}` : ""}`)}
            series={series}
            xLabel="Month"
            yLabel="Reports"
            mark={peak}
          />
        </section>

        <section className="card">
          <div className="card-head"><h2>Reports by hour × weekday</h2></div>
          <p className="card-sub">
            Each cell = count. Darker = more reports.
            {now && <> Outlined: now, {WEEKDAYS[(now.getDay() + 6) % 7]} {String(now.getHours()).padStart(2, "0")}h.</>}
          </p>
          <Heatmap
            rows={WEEKDAYS}
            cols={Array.from({ length: 24 }, (_, h) => `${h}`)}
            values={grid}
            mark={now ? [(now.getDay() + 6) % 7, now.getHours()] : null}
          />
        </section>

        <section className="card">
          <div className="card-head"><h2>Data sources &amp; resolution</h2></div>
          <p className="card-sub">Every chart&apos;s provenance, declared on the page.</p>
          <table className="provenance">
            <tbody>
              <tr>
                <th>Community reports<small>Street points · user-submitted{ev.showExamples ? " + synthetic examples" : ""}</small></th>
                <td>{latest ? `Last record ${DATE.format(new Date(latest))}` : "No records"}</td>
              </tr>
              <tr>
                <th>Street lighting<small>OpenStreetMap · tagged edges</small></th>
                <td>{district.lighting.lit}% coverage{exampleNote}</td>
              </tr>
              <tr>
                <th>Unknown lighting<small>Edges without a lighting tag</small></th>
                <td>{district.lighting.unknown}% of streets{exampleNote}</td>
              </tr>
              <tr>
                <th>Nearby places<small>Opening hours · OpenStreetMap POI</small></th>
                <td>{district.places} within area{exampleNote}</td>
              </tr>
              <tr>
                <th>Area outline<small>Hand-traced district boundary</small></th>
                <td>Approximate — good to a street or two</td>
              </tr>
              <tr>
                <th>Official crime<small>Neighbourhood aggregates · CBS</small></th>
                <td>Not currently displayed — switch it on in Explore</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card">
          <div className="card-head"><h2>How {district.name} compares with other {city.name} neighbourhoods</h2></div>
          <p className="card-sub">Reports per km of road network · higher = more reports relative to area size, not more risk.</p>
          <RankBars rows={perKm} highlight={district.id} axisLabel="Reports per km of road" onPick={setPicked} />
        </section>
      </div>

      <p className="caveat">A count is a count: no verdict, no forecast, no rating. Observed reports describe this dataset, not incident risk.</p>
    </main>
  );
}
