"use client";

/**
 * The DATA DASHBOARD — for researchers, the police and the municipality. Not
 * part of the woman's tool, and not needed to plan a route.
 *
 * The supervisor meeting of 4 Nov 2026 split the app by audience: "You have
 * the use case of the woman who wants to figure out where she wants to go …
 * and you have the municipality, the police — where should we be. Separate
 * those." The analytics were kept ("hide them, don't delete them — you can
 * show a dashboard with 100 things about the data") and moved here:
 *
 *   * neighbourhoods against each other, per km of road;
 *   * lighting by neighbourhood (static — it never changes with a filter);
 *   * who reported, and why: respondent age × reason;
 *   * when reports were made, month by month (bars — the data is sparse);
 *   * how far reports are from the route last picked;
 *   * where every figure comes from.
 *
 * Each card is titled with the QUESTION it answers, so the page reads as a
 * story rather than a wall of charts. Still no score anywhere.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import BoardHeader, { Sources } from "@/components/BoardHeader";
import { Heatmap, Histogram, Key, MonthBars, RankBars, StackedShare, Swatch } from "@/components/charts";
import { useEvidence } from "@/components/EvidenceProvider";
import { districtOf, histogram, monthKeys, REPORT_TYPES, reportType } from "@/lib/evidence";
import { distanceToPathM } from "@/lib/geo";
import { AGE_BANDS } from "@/lib/pointer";
import { exactDay } from "@/lib/reports";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const DISTANCE_MAX = 500;
const DISTANCE_BIN = 20;

export default function DashboardBoard() {
  const ev = useEvidence();
  const { city } = ev;
  const [picked, setPicked] = useState<string | null>(null);
  const district = picked ? city.districts.find((d) => d.id === picked) ?? null : null;

  const where = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const report of ev.reports) map.set(report.id, districtOf(city, report.point)?.id ?? null);
    return map;
  }, [ev.reports, city]);

  const here = useMemo(
    () => (picked ? ev.reports.filter((report) => where.get(report.id) === picked) : ev.reports),
    [ev.reports, where, picked],
  );
  const scope = district ? district.name : `all of ${city.name}`;

  /* neighbourhoods against each other, per km of road */
  const perKm = city.districts.map((d) => ({
    id: d.id,
    label: d.name,
    value: ev.reports.filter((r) => where.get(r.id) === d.id).length / Math.max(0.1, d.roadKm || 0.1),
  })).sort((a, b) => b.value - a.value);

  /* age × reason */
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

  /* month by month */
  const dated = useMemo(() => here.filter(exactDay), [here]);
  const monthList = useMemo(() => {
    const days = dated.map((report) => report.at.slice(0, 10)).sort();
    return days.length ? monthKeys(days[0]!, days[days.length - 1]!) : [];
  }, [dated]);
  const monthBins = monthList.map((key) => {
    const inIt = dated.filter((report) => report.at.slice(0, 7) === key);
    return {
      id: key,
      label: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`,
      short: `${MONTHS[Number(key.slice(5, 7)) - 1]} ’${key.slice(2, 4)}`,
      value: inIt.length,
      detail: REPORT_TYPES.map((type) => {
        const n = inIt.filter((report) => reportType(report.category) === type.id).length;
        return n ? <span key={type.id}>{type.short}: {n}</span> : null;
      }),
    };
  });

  /* distance to the route last picked */
  const route = ev.route?.path ?? city.exampleRoute;
  const distances = here.map((r) => distanceToPathM(r.point, route));
  const distanceBins = histogram(distances, 0, DISTANCE_MAX, DISTANCE_BIN);

  const latest = here.reduce((max, report) => (report.at > max ? report.at : max), "");
  const stories = here.filter((report) => report.note).length;
  const figureNote = city.figures === "osm" ? "" : " · not measured yet";

  return (
    <main className="board dashboard">
      <BoardHeader
        title="Data dashboard"
        note={<>For researchers, the police and the municipality — the data as data. <Link href="/">Planning a route? Start here →</Link></>}
      />

      <p className="intro">
        The two other views help one person decide where to go. This page is for understanding the reports
        themselves: where they cluster, who made them, when, and how complete the map data is. Every chart is a
        count — none of them is a rating of a place.
      </p>

      <div className="area-pick" role="group" aria-label="Neighbourhood">
        <button type="button" className={picked === null ? "on" : undefined} onClick={() => setPicked(null)}>All of {city.name}</button>
        {city.districts.map((d) => (
          <button key={d.id} type="button" className={d.id === picked ? "on" : undefined} onClick={() => setPicked(d.id === picked ? null : d.id)}>{d.name}</button>
        ))}
      </div>

      <div className="area-grid">
        <section className="card">
          <div className="card-head"><h2>Which neighbourhoods have the most reported places, for their size?</h2></div>
          <p className="card-sub">Reported places per km of road. Higher means more places were reported relative to the street network — not more risk. Tap one to focus the page on it.</p>
          <RankBars rows={perKm} highlight={picked} axisLabel="Reported places per km of road" onPick={(id) => setPicked(id === picked ? null : id)} />
        </section>

        <section className="card">
          <div className="card-head"><h2>How much of each neighbourhood is mapped as lit?</h2></div>
          <p className="card-sub">Share of street length by its OpenStreetMap lighting tag. Unknown is its own category — nobody has tagged it, which is not the same as dark.</p>
          <Key items={[
            { swatch: <Swatch colour="var(--lit)" />, label: "Lit — street lighting is mapped" },
            { swatch: <Swatch colour="var(--unlit)" />, label: "Unlit" },
            { swatch: <Swatch colour="" hatch />, label: "Unknown" },
          ]} />
          <StackedShare
            rows={city.districts.map((d) => ({ id: d.id, label: d.name, ...d.lighting }))}
            selected={picked ? [picked] : []}
            onPick={(id) => setPicked(id === picked ? null : id)}
            axisLabel={`Percentage of street length${figureNote}`}
          />
        </section>

        <section className="card">
          <div className="card-head"><h2>Who reported, and why? — {scope}</h2></div>
          <p className="card-sub">Each cell is a count of reported places, by the respondent&apos;s age band and the reason they gave. {withAge} of {here.length} give an age.</p>
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
          <div className="card-head"><h2>When were places reported? — {scope}</h2></div>
          <p className="card-sub">
            Reports per month: when the survey was filled in, not when anything happened, and not a trend in risk.
            Hover a bar for the reasons.{here.length > dated.length && <> {here.length - dated.length} reported during a window with no day are not drawn.</>}
          </p>
          <MonthBars bins={monthBins} focus={null} yLabel="Reported places" height={170} />
        </section>

        <section className="card">
          <div className="card-head"><h2>How far are reported places from the route you picked?</h2></div>
          <p className="card-sub">
            {ev.route ? <>Route: {ev.route.label}.</> : <>No route picked yet — measured to a default walk through {city.name}. <Link href="/">Pick one →</Link></>}
            {" "}Distance from each reported place in {scope} to the line.
          </p>
          <Histogram
            bins={distanceBins}
            binLabel={(i) => String(i * DISTANCE_BIN)}
            tickEvery={[0, 5, 10, 15, 20, 24]}
            xLabel="Distance (m)"
            yLabel="Reported places"
            height={190}
          />
        </section>

        <section className="card">
          <div className="card-head"><h2>Where does each figure come from?</h2></div>
          <table className="provenance">
            <tbody>
              <tr>
                <th>Reported places<small>Pointer survey (KRO-NCRV) + study team + community</small></th>
                <td>{here.length} in {scope} · {stories} with a shared story{latest ? ` · last ${DATE.format(new Date(latest))}` : ""}</td>
              </tr>
              <tr>
                <th>Street lighting<small>OpenStreetMap · tagged edges</small></th>
                <td>{district ? `${district.lighting.lit}% lit` : "per neighbourhood, above"}{figureNote}</td>
              </tr>
              <tr>
                <th>Places to go in<small>Opening hours · OpenStreetMap POI</small></th>
                <td>{district ? `${district.places} within the area` : `${city.districts.reduce((sum, d) => sum + d.places, 0)} in the city`}{figureNote}</td>
              </tr>
              <tr>
                <th>Crowd<small>Pedestrian streets and bars · OpenStreetMap</small></th>
                <td>A stand-in: OSM records no footfall</td>
              </tr>
              <tr>
                <th>Area outline<small>Hand-traced district boundary</small></th>
                <td>Approximate — good to a street or two</td>
              </tr>
              <tr>
                <th>Official crime<small>Neighbourhood aggregates · CBS</small></th>
                <td>Switch it on in Around me; the CBS feed is still being fixed</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <p className="caveat">A count is a count: no verdict, no forecast, no rating. Reported places describe what respondents told a survey, not incident risk.</p>
      <Sources />
    </main>
  );
}
