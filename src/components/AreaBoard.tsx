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
import { useMemo, useState } from "react";

import BoardHeader, { Sources } from "@/components/BoardHeader";
import { GroupedBars, Heatmap, Key, Lines, RankBars, Swatch } from "@/components/charts";
import { useEvidence } from "@/components/EvidenceProvider";
import { TYPE_INK } from "@/components/ExploreBoard";
import { districtById } from "@/lib/cities";
import { districtOf, monthKeys, REPORT_TYPES, reportType, WHEN_BINS, whenOf } from "@/lib/evidence";
import { AGE_BANDS } from "@/lib/pointer";
import { exactDay } from "@/lib/reports";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export default function AreaBoard({ districtId }: { districtId: string | null }) {
  const ev = useEvidence();
  const { city } = ev;
  const [picked, setPicked] = useState<string | null>(null);
  const district = districtById(city, picked ?? districtId) ?? city.districts[0]!;

  const where = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const report of ev.reports) map.set(report.id, districtOf(city, report.point)?.id ?? null);
    return map;
  }, [ev.reports, city]);

  const here = useMemo(() => ev.reports.filter((report) => where.get(report.id) === district.id), [ev.reports, where, district.id]);
  const latest = here.reduce((max, report) => (report.at > max ? report.at : max), "");
  const dated = useMemo(() => here.filter(exactDay), [here]);
  const months = useMemo(() => {
    const days = dated.map((report) => report.at.slice(0, 10)).sort();
    return days.length ? monthKeys(days[0]!, days[days.length - 1]!) : [];
  }, [dated]);

  const byType = REPORT_TYPES.map((type) => ({ ...type, count: here.filter((r) => reportType(r.category) === type.id).length }));
  const series = REPORT_TYPES.map((type) => {
    const index = new Map(months.map((key, i) => [key, i]));
    const values = new Array<number>(months.length).fill(0);
    for (const report of dated) {
      const at = index.get(report.at.slice(0, 7));
      if (at !== undefined && reportType(report.category) === type.id) values[at]! += 1;
    }
    return { id: type.id, label: type.short, values, colour: TYPE_INK[type.id] };
  });
  const peak = (() => {
    const totals = months.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
    const max = Math.max(0, ...totals);
    const at = totals.indexOf(max);
    return max > 0 && months.length >= 6 ? { at, label: "Peak month" } : null;
  })();

  /** Respondent age band × reason — who marked places here, and why. */
  const grid = useMemo(() => {
    const values = REPORT_TYPES.map(() => new Array<number>(AGE_BANDS.length).fill(0));
    for (const report of here) {
      const col = report.age ? AGE_BANDS.indexOf(report.age) : -1;
      const row = REPORT_TYPES.findIndex((type) => type.id === reportType(report.category));
      if (col >= 0 && row >= 0) values[row]![col]! += 1;
    }
    return values;
  }, [here]);
  const withAge = here.filter((report) => report.age).length;

  const whenRows = WHEN_BINS.map((bin) => ({
    id: bin.id,
    label: bin.label,
    value: here.filter((report) => whenOf(report) === bin.id).length,
    context: ev.reports.filter((report) => whenOf(report) === bin.id).length,
  })).filter((row) => row.id !== "unknown" || row.context > 0);
  const stories = here.filter((report) => report.note).length;

  const perKm = city.districts.map((d) => ({
    id: d.id,
    label: d.name,
    value: ev.reports.filter((r) => where.get(r.id) === d.id).length / Math.max(0.1, d.roadKm || 0.1),
  })).sort((a, b) => b.value - a.value);

  const figureNote = city.figures === "osm" ? "" : " · not measured yet";

  return (
    <main className="board area">
      <BoardHeader
        title={`${district.name} in detail`}
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
              <span>{type.short}</span>
            </div>
          ))}
          <div className="kpi"><b className="lit-ink">{district.lighting.lit}%</b><span>Streets mapped lit<small>by length{figureNote}</small></span></div>
          <div className="kpi"><b>{district.lighting.unlit}%</b><span>Streets mapped unlit<small>by length{figureNote}</small></span></div>
          <div className="kpi"><b className="muted">{district.lighting.unknown}%</b><span>Lighting unknown<small>missing data</small></span></div>
        </div>
      </section>

      <div className="area-grid">
        <section className="card">
          <div className="card-head"><h2>When places were marked — by reason</h2></div>
          <p className="card-sub">
            The month the survey was filled in, not when anything happened.
            {here.length > dated.length && <> {here.length - dated.length} marked during a window with no day given are not drawn.</>}
          </p>
          <Key items={series.map((s) => ({ swatch: <Swatch colour={s.colour} />, label: s.label }))} />
          <Lines
            labels={months.map((key) => `${MONTHS[Number(key.slice(5, 7)) - 1]}${months.length > 12 ? ` ${key.slice(2, 4)}` : ""}`)}
            series={series}
            xLabel="Month"
            yLabel="Marked places"
            mark={peak}
          />
        </section>

        <section className="card">
          <div className="card-head"><h2>When respondents feel this way here</h2></div>
          <Key items={[
            { swatch: <Swatch colour="var(--report)" />, label: district.name },
            { swatch: <Swatch colour="var(--context)" />, label: `All of ${city.name}` },
          ]} />
          <GroupedBars rows={whenRows} focus={null} onPick={() => undefined} axisLabel="Marked places" labelWidth={170} />
        </section>

        <section className="card">
          <div className="card-head"><h2>Who marked places here — age × reason</h2></div>
          <p className="card-sub">Each cell = count of places. Age is the respondent&apos;s band; {withAge} of {here.length} give one.</p>
          <Heatmap
            rows={REPORT_TYPES.map((type) => type.short)}
            cols={AGE_BANDS}
            values={grid}
            mark={null}
            xLabel="Respondent age band"
            labelWidth={150}
          />
        </section>

        <section className="card">
          <div className="card-head"><h2>Data sources &amp; resolution</h2></div>
          <p className="card-sub">Every chart&apos;s provenance, declared on the page.</p>
          <table className="provenance">
            <tbody>
              <tr>
                <th>Marked places<small>Pointer survey (KRO-NCRV) + study team + community</small></th>
                <td>{here.length} here · {stories} with a shared story{latest ? ` · last ${DATE.format(new Date(latest))}` : ""}</td>
              </tr>
              <tr>
                <th>Street lighting<small>OpenStreetMap · tagged edges</small></th>
                <td>{district.lighting.lit}% coverage{figureNote}</td>
              </tr>
              <tr>
                <th>Unknown lighting<small>Edges without a lighting tag</small></th>
                <td>{district.lighting.unknown}% of streets{figureNote}</td>
              </tr>
              <tr>
                <th>Nearby places<small>Opening hours · OpenStreetMap POI</small></th>
                <td>{district.places} within area{figureNote}</td>
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
          <p className="card-sub">Marked places per km of road network · higher = more places marked relative to area size, not more risk.</p>
          <RankBars rows={perKm} highlight={district.id} axisLabel="Marked places per km of road" onPick={setPicked} />
        </section>
      </div>

      <p className="caveat">A count is a count: no verdict, no forecast, no rating. Marked places describe what respondents told a survey, not incident risk.</p>
      <Sources />
    </main>
  );
}
