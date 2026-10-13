"use client";

/**
 * Board 01 — "Explore urban mobility evidence". `docs/reference/board-01-explore.webp`
 * is the picture it is built to; `docs/Maddie-Evidence-Dashboard.md` is the spec.
 *
 * One map and coordinated small views, linked both ways (Munzner ch. 12):
 *
 *   * tick or click a NEIGHBOURHOOD → it is the selection in every chart;
 *   * click a BAR (or a slice)      → that report type is focused everywhere;
 *   * BRUSH the hours               → every other view re-counts within them.
 *
 * Nothing here is a score. Counts are counts; missing lighting is its own
 * hatched category; the reports are context, never inputs to a verdict.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarDays, Info, Plus, SlidersHorizontal, X } from "lucide-react";

import BoardHeader from "@/components/BoardHeader";
import { Donut, GroupedBars, Histogram, Key, Lines, StackedShare, Swatch } from "@/components/charts";
import { useEvidence } from "@/components/EvidenceProvider";
import { cityBox, PLACE_KINDS, useLiveLayers, usePoliceFigures, useRecording } from "@/components/useMapData";
import type { City } from "@/lib/cities";
import { districtOf, histogram, hourOf, monthKeys, REPORT_TYPES, reportType, type ReportType } from "@/lib/evidence";
import { distanceToPathM } from "@/lib/geo";
import { EMPTY_LAYERS, type LayerData } from "@/lib/layers";
import type { LatLng } from "@/lib/osrm";
import { newReportId, type Report } from "@/lib/reports";

const ExploreMap = dynamic(() => import("@/components/ExploreMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading the map…</div>,
});

/** The purple ramp the type views use: one meaning (a report), four types. */
export const TYPE_INK: Record<ReportType, string> = {
  harassment: "var(--type-1)", catcalling: "var(--type-2)", assault: "var(--type-3)", other: "var(--type-4)",
};

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DISTANCE_MAX = 500;
const DISTANCE_BIN = 20;

const day = (iso: string) => iso.slice(0, 10);

export default function ExploreBoard() {
  const { city } = useEvidence();
  // Keyed by city: every selection below belongs to one city's districts.
  return <ExploreFor key={city.id} city={city} />;
}

function ExploreFor({ city }: { city: City }) {
  const ev = useEvidence();
  const [districts, setDistricts] = useState<string[]>(() => [city.districts[0]?.id ?? ""]);
  const [community, setCommunity] = useState(true);
  const [official, setOfficial] = useState(false);
  const [types, setTypes] = useState<ReportType[]>(REPORT_TYPES.map((type) => type.id));
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [showLighting, setShowLighting] = useState(false);
  const [showPlaces, setShowPlaces] = useState(true);
  const [focus, setFocus] = useState<ReportType | null>(null);
  const [brush, setBrush] = useState<[number, number] | null>([18, 23]);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ point: LatLng; type: ReportType; note: string } | null>(null);
  const [tilesOk, setTilesOk] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  /* ── the data ───────────────────────────────────────────────────────── */
  const box = useMemo(() => cityBox(city), [city]);
  const { recording } = useRecording(city.scenario);
  const live = useLiveLayers(city.scenario ? null : box, showPlaces ? PLACE_KINDS : [], showLighting);
  const layers: LayerData = useMemo(() => {
    const source = city.scenario ? recording?.layers ?? EMPTY_LAYERS : live.layers;
    return {
      ...source,
      spots: source.spots.filter((spot) => PLACE_KINDS.includes(spot.kind)),
    };
  }, [city.scenario, recording, live.layers]);
  const police = usePoliceFigures(official, box);

  const extent = useMemo(() => {
    const days = ev.reports.map((report) => day(report.at)).sort();
    return { from: days[0] ?? "2025-01-01", to: days[days.length - 1] ?? "2025-12-31" };
  }, [ev.reports]);
  const dates = range ?? extent;

  /** Each report's district, worked out once. */
  const where = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const report of ev.reports) map.set(report.id, districtOf(city, report.point)?.id ?? null);
    return map;
  }, [ev.reports, city]);

  /** Every record the filters on the left let through. */
  const shown = useMemo(() => {
    if (!community) return [];
    return ev.reports.filter((report) => {
      const d = day(report.at);
      return types.includes(reportType(report.category)) && d >= dates.from && d <= dates.to;
    });
  }, [ev.reports, community, types, dates]);

  const inSelection = (report: Report) => districts.length === 0 || districts.includes(where.get(report.id) ?? "");
  const inBrush = (report: Report) => {
    if (!brush) return true;
    const hour = hourOf(report);
    return hour >= Math.min(...brush) && hour <= Math.max(...brush);
  };
  const inFocus = (report: Report) => focus === null || reportType(report.category) === focus;

  const selectedNames = districts.map((id) => city.districts.find((d) => d.id === id)?.name).filter(Boolean).join(", ");
  const selectionLabel = districts.length === 0 ? "All areas" : `Selected area (${selectedNames})`;

  /* ── linked views ───────────────────────────────────────────────────── */
  const brushed = shown.filter(inBrush);
  const typeRows = REPORT_TYPES.filter((type) => types.includes(type.id)).map((type) => ({
    id: type.id,
    label: type.label,
    value: brushed.filter((report) => inSelection(report) && reportType(report.category) === type.id).length,
    context: brushed.filter((report) => reportType(report.category) === type.id).length,
  }));

  const hourBins = histogram(shown.filter((r) => inSelection(r) && inFocus(r)).map(hourOf), 0, 24, 1);

  const route = ev.route?.path ?? city.exampleRoute;
  const routeName = ev.route ? ev.route.label : `example route through ${city.name}`;
  const distances = brushed.filter((r) => inSelection(r) && inFocus(r)).map((r) => distanceToPathM(r.point, route));
  const distanceBins = histogram(distances, 0, DISTANCE_MAX, DISTANCE_BIN);

  const faded = useMemo(
    () => new Set(shown.filter((report) => !(inBrush(report) && inFocus(report))).map((report) => report.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inBrush/inFocus read brush/focus
    [shown, brush, focus],
  );

  const monthList = useMemo(() => monthKeys(dates.from, dates.to), [dates.from, dates.to]);
  const months = useMemo(() => {
    const selected = brushed.filter(inSelection);
    const index = new Map(monthList.map((key, i) => [key, i]));
    return REPORT_TYPES.filter((type) => types.includes(type.id)).map((type) => {
      const values = new Array<number>(monthList.length).fill(0);
      for (const report of selected) {
        const at = index.get(day(report.at).slice(0, 7));
        if (at !== undefined && reportType(report.category) === type.id) values[at]! += 1;
      }
      return { id: type.id, label: type.label, values, colour: TYPE_INK[type.id], width: focus === type.id ? 3.2 : focus ? 1.2 : 2 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inSelection reads districts
  }, [brushed, districts, types, focus, monthList]);

  /* ── actions ────────────────────────────────────────────────────────── */
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const pickDistrict = (id: string) => setDistricts((current) => toggle(current, id));
  const pickType = (id: string) => setFocus((current) => (current === id ? null : (id as ReportType)));

  function saveDraft() {
    if (!draft) return;
    const note = draft.note.trim().slice(0, 280);
    ev.addReport({
      id: newReportId(Date.now(), Math.random()),
      category: draft.type,
      point: draft.point,
      at: new Date().toISOString(),
      source: "community",
      ...(note ? { note } : {}),
    });
    setDraft(null);
    setAdding(false);
  }

  const firstSelected = city.districts.find((d) => d.id === districts[0]);

  return (
    <main className="board explore">
      <BoardHeader
        title="Explore urban mobility evidence"
        kind="Synthetic example data"
        note={<>Select a bar or map area → highlight related records in every view</>}
      />

      <div className="explore-grid">
        {/* ── filters ─────────────────────────────────────────────────── */}
        <aside className={`card filters${filtersOpen ? " open" : ""}`} aria-label="Filters">
          <button type="button" className="filters-toggle" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
            <SlidersHorizontal size={16} aria-hidden /> Filters
            <span className="muted">{city.name} · {selectedNames || "all areas"} · {types.length} of {REPORT_TYPES.length} types</span>
          </button>
          <section>
            <h2>Area</h2>
            <select value={city.id} onChange={(event) => ev.setCity(event.target.value)} aria-label="Area">
              {ev.cities.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <h3>Neighbourhood ({city.districts.length} shown)</h3>
            {city.districts.map((district) => (
              <label key={district.id} className="check">
                <input type="checkbox" checked={districts.includes(district.id)} onChange={() => pickDistrict(district.id)} />
                <span>{district.name}</span>
              </label>
            ))}
            {firstSelected && (
              <Link className="more-link" href={`/area?d=${firstSelected.id}`}>Open {firstSelected.name} in detail →</Link>
            )}
          </section>

          <section>
            <h2>Report source</h2>
            <label className="check">
              <input type="checkbox" checked={community} onChange={() => setCommunity(!community)} />
              <span>Community reports<small>Street points (user-submitted)</small></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={official} onChange={() => setOfficial(!official)} />
              <span>Official crime <em>(optional)</em><small>Neighbourhood aggregates</small></span>
              <button type="button" className="info" onClick={(event) => { event.preventDefault(); setInfoOpen(!infoOpen); }} aria-label="About official crime figures" aria-expanded={infoOpen}>
                <Info size={15} />
              </button>
            </label>
            {infoOpen && (
              <p className="note">
                CBS police figures, per neighbourhood per month — drawn over the whole area because that is the
                grain they are published at. More recorded offences is not the same as more risk: reporting rates,
                footfall and policing all move them. Harassment and catcalling are not in any police table.
              </p>
            )}
            {official && police.busy && <p className="note">Reading the CBS figures…</p>}
            {official && police.error && <p className="note warn">{police.error}</p>}
            <label className="check">
              <input type="checkbox" checked={ev.showExamples} onChange={() => ev.setShowExamples(!ev.showExamples)} />
              <span>Example records<small>Synthetic — nothing here happened</small></span>
            </label>
          </section>

          <section>
            <h2>Report type</h2>
            {REPORT_TYPES.map((type) => (
              <label key={type.id} className="check">
                <input type="checkbox" checked={types.includes(type.id)} onChange={() => setTypes(toggle(types, type.id))} />
                <span>{type.label}</span>
              </label>
            ))}
          </section>

          <section>
            <h2>Date range</h2>
            <button type="button" className="date-range" onClick={() => setDatesOpen(!datesOpen)} aria-expanded={datesOpen}>
              <CalendarDays size={16} aria-hidden />
              <span>{DATE.format(new Date(dates.from))} – {DATE.format(new Date(dates.to))}</span>
            </button>
            {datesOpen && (
              <div className="date-pick">
                <label htmlFor="from">From</label>
                <input id="from" type="date" value={dates.from} max={dates.to} onChange={(e) => setRange({ ...dates, from: e.target.value || extent.from })} />
                <label htmlFor="to">To</label>
                <input id="to" type="date" value={dates.to} min={dates.from} onChange={(e) => setRange({ ...dates, to: e.target.value || extent.to })} />
              </div>
            )}
          </section>

          <section>
            <h2>Map layers <em>(optional)</em></h2>
            <label className="check">
              <input type="checkbox" checked={showLighting} onChange={() => setShowLighting(!showLighting)} />
              <span>Street lighting (mapped)</span>
              <Swatch colour="var(--lit)" round />
            </label>
            <label className="check">
              <input type="checkbox" checked={showPlaces} onChange={() => setShowPlaces(!showPlaces)} />
              <span>Nearby places</span>
              <span className="heart" aria-hidden>♥</span>
            </label>
            {!city.scenario && (showPlaces || showLighting) && live.error && <p className="note warn">{live.error}</p>}
          </section>
        </aside>

        {/* ── the map ─────────────────────────────────────────────────── */}
        <section className="card map-card">
          <div className="card-head">
            <h2>{city.name} — community reports (street points)</h2>
            <Key items={[
              { swatch: <Swatch colour="var(--report)" round />, label: "Community report" },
              { swatch: <span className="heart" aria-hidden>♥</span>, label: "Nearby place" },
              { swatch: <i className="sw sw-area" aria-hidden />, label: selectionLabel },
            ]} />
            <button type="button" className={`btn-small${adding ? " on" : ""}`} onClick={() => { setAdding(!adding); setDraft(null); }}>
              {adding ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add a report</>}
            </button>
          </div>
          <div className="map-wrap">
            <ExploreMap
              city={city}
              tone={ev.tone}
              reports={shown}
              faded={faded}
              selectedDistricts={districts}
              onDistrict={pickDistrict}
              layers={layers}
              showLighting={showLighting}
              showPlaces={showPlaces}
              police={official ? police.areas : []}
              openReport={openReport}
              onOpenReport={setOpenReport}
              adding={adding}
              onAdd={(point) => setDraft({ point, type: "harassment", note: "" })}
              onTiles={setTilesOk}
            />
            {!tilesOk && <p className="map-banner">The basemap did not load — the records are still drawn where they are.</p>}
            {adding && !draft && <p className="map-banner">Tap the map where it happened.</p>}
            {draft && (
              <form className="draft" onSubmit={(event) => { event.preventDefault(); saveDraft(); }}>
                <b>New community report</b>
                <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ReportType })} aria-label="Type">
                  {REPORT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                </select>
                <textarea value={draft.note} maxLength={280} placeholder="What happened here? (optional)" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                <p className="note">
                  {ev.backend === "mongo" ? "Shared with everyone using this site." : "Kept in this browser only — no database is configured."}
                </p>
                <div className="row">
                  <button type="button" className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button>
                  <button type="submit" className="btn">Save report</button>
                </div>
              </form>
            )}
            <div className="map-key">
              <span><Swatch colour="var(--report)" round /> Community reports: street points (user-submitted)</span>
              <span><i className="sw sw-dashed" aria-hidden /> Official crime: neighbourhood aggregates ({official ? "on" : "off"})</span>
            </div>
          </div>
        </section>

        {/* ── by type ─────────────────────────────────────────────────── */}
        <section className="card types-card">
          <div className="card-head">
            <h2>Community reports by type</h2>
          </div>
          <Key items={[
            { swatch: <Swatch colour="var(--report)" />, label: selectionLabel },
            { swatch: <Swatch colour="var(--context)" />, label: "All displayed records" },
          ]} />
          <GroupedBars rows={typeRows} focus={focus} onPick={pickType} axisLabel="Number of reports" />
        </section>

        {/* ── when ────────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>When reports occurred</h2>
            {brush && <button type="button" className="link" onClick={() => setBrush(null)}>Clear</button>}
          </div>
          <Histogram
            bins={hourBins}
            binLabel={(i) => String(i).padStart(2, "0")}
            tickEvery={[0, 6, 12, 18, 23]}
            xLabel="Hour of day"
            yLabel="Report count"
            brush={brush}
            onBrush={setBrush}
            brushHint="Brush a time range"
          />
        </section>

        {/* ── lighting ────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head"><h2>Lighting data by neighbourhood</h2></div>
          <Key items={[
            { swatch: <Swatch colour="var(--lit)" />, label: "Mapped lit" },
            { swatch: <Swatch colour="var(--unlit)" />, label: "Mapped unlit" },
            { swatch: <Swatch colour="" hatch />, label: "Unknown" },
          ]} />
          <StackedShare
            rows={city.districts.map((d) => ({ id: d.id, label: d.name, ...d.lighting }))}
            selected={districts}
            onPick={pickDistrict}
            axisLabel="Percentage of street length"
          />
        </section>

        {/* ── distance ────────────────────────────────────────────────── */}
        <section className="card">
          <div className="card-head">
            <h2>Distance from report to selected route</h2>
          </div>
          <p className="card-sub">
            {ev.route ? <>Route: {routeName}</> : <>No route picked yet — measuring to an {routeName}. <Link href="/compare">Pick one →</Link></>}
          </p>
          <Histogram
            bins={distanceBins}
            binLabel={(i) => String(i * DISTANCE_BIN)}
            tickEvery={[0, 5, 10, 15, 20, 24]}
            xLabel="Distance (m)"
            yLabel="Reports"
            height={190}
          />
        </section>
      </div>

      {/* ── more views: what the team asked for after the mockups ────── */}
      <h2 className="section-title">More views of the same records</h2>
      <div className="more-grid">
        <section className="card">
          <div className="card-head"><h2>Share of reports by type</h2></div>
          <p className="card-sub">{selectionLabel}{brush ? `, ${String(Math.min(...brush)).padStart(2, "0")}–${String(Math.max(...brush)).padStart(2, "0")}h` : ""}. Click a slice to focus it everywhere.</p>
          <Donut
            parts={typeRows.map((row) => ({ id: row.id, label: row.label, value: row.value, colour: TYPE_INK[row.id as ReportType] }))}
            focus={focus}
            onPick={pickType}
            centre="reports"
          />
        </section>
        <section className="card span-2">
          <div className="card-head"><h2>Reports over time, by type</h2></div>
          <p className="card-sub">{selectionLabel}. Counts per month of the records shown — not a trend in risk.</p>
          <Key items={months.map((series) => ({ swatch: <Swatch colour={series.colour} />, label: series.label }))} />
          <Lines labels={monthList.map((key) => `${MONTHS[Number(key.slice(5, 7)) - 1]}${monthList.length > 12 ? ` ${key.slice(2, 4)}` : ""}`)} series={months} xLabel="Month" yLabel="Reports" />
        </section>
      </div>

      <p className="caveat">Observed reports describe this dataset, not incident risk. Missing lighting stays unknown.</p>
    </main>
  );
}
