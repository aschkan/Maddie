"use client";

/**
 * "Around me" — what has been reported near you, and what is there: street
 * lighting, places to go in, crowds. The SECOND view of the woman's tool; the
 * first is "Plan a route" (`CompareBoard`, the landing page).
 *
 * Pruned after the supervisor meetings of 28 Oct and 4 Nov 2026 ("everything
 * is a lot", "some graphs are repetitive in every layout"):
 *
 *   * ONE chart for why places were reported — a stacked bar with a split
 *     toggle (none / age group / when) replaces the bar chart, the pie and
 *     the age × reason matrix. Percentages are in parentheses on the bars.
 *   * A small BAR timeline of when reports were made (bars, not lines — the
 *     months are sparse).
 *   * Clicking a neighbourhood shows its numbers INLINE; there is no separate
 *     area board any more.
 *   * Detailed numbers live in tooltips over the bars.
 *   * The analysts' charts (lighting by neighbourhood, per-km comparison,
 *     distance to route, the matrix) are on `/dashboard`, not here.
 *
 * Linked both ways (Munzner ch. 12): a neighbourhood, a reason bar and a
 * month each filter every other view. Nothing here is a score.
 */

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, Info, Plus, SlidersHorizontal, X } from "lucide-react";

import BoardHeader, { Sources } from "@/components/BoardHeader";
import { Key, MonthBars, pct, ShareBars, StackBars, Swatch } from "@/components/charts";
import { useEvidence } from "@/components/EvidenceProvider";
import ImportancePanel, { RankDot } from "@/components/ImportancePanel";
import { cityBox, PLACE_KINDS, useLiveLayers, usePoliceFigures, useRecording } from "@/components/useMapData";
import type { City } from "@/lib/cities";
import { CROWD_KINDS, districtOf, monthKeys, REPORT_TYPES, reportType, WHEN_BINS, whenOf, type ReportType, type WhenBin } from "@/lib/evidence";
import { IMPORTANCE_ITEMS } from "@/lib/importance";
import { EMPTY_LAYERS, type LayerData } from "@/lib/layers";
import type { LatLng } from "@/lib/osrm";
import { ADJUSTMENTS, AGE_BANDS } from "@/lib/pointer";
import { exactDay, inDates, newReportId, WHEN_OPTIONS, type Report, type When } from "@/lib/reports";

const ExploreMap = dynamic(() => import("@/components/ExploreMap"), {
  ssr: false,
  loading: () => <div className="map map-loading">Loading the map…</div>,
});

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WHEN_INK: Record<WhenBin, string> = { dark: "var(--when-dark)", any: "var(--when-any)", day: "var(--when-day)", unknown: "var(--unknown)" };

type Split = "none" | "age" | "when";
const SPLITS: { id: Split; label: string }[] = [
  { id: "none", label: "No split" },
  { id: "age", label: "By age group" },
  { id: "when", label: "By time of day" },
];

const day = (iso: string) => iso.slice(0, 10);
const monthLabel = (key: string, long = false) => `${MONTHS[Number(key.slice(5, 7)) - 1]}${long ? ` ${key.slice(0, 4)}` : ` ’${key.slice(2, 4)}`}`;

export default function ExploreBoard() {
  const { city } = useEvidence();
  // Keyed by city: every selection below belongs to one city's districts.
  return <ExploreFor key={city.id} city={city} />;
}

function ExploreFor({ city }: { city: City }) {
  const ev = useEvidence();
  const [districts, setDistricts] = useState<string[]>([]);
  const [community, setCommunity] = useState(true);
  const [official, setOfficial] = useState(false);
  const [types, setTypes] = useState<ReportType[]>(REPORT_TYPES.map((type) => type.id));
  const [whens, setWhens] = useState<WhenBin[]>(WHEN_BINS.map((bin) => bin.id));
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [showLighting, setShowLighting] = useState(false);
  const [showPlaces, setShowPlaces] = useState(true);
  const [showCrowd, setShowCrowd] = useState(false);
  const [showBars, setShowBars] = useState(false);
  const [focus, setFocus] = useState<ReportType | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [split, setSplit] = useState<Split>("none");
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ point: LatLng; type: ReportType; when: When | ""; note: string } | null>(null);
  const [tilesOk, setTilesOk] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [shadeOpen, setShadeOpen] = useState(false);

  /* ── the data ───────────────────────────────────────────────────────── */
  const box = useMemo(() => cityBox(city), [city]);
  const { recording } = useRecording(city.scenario);
  const wantedKinds = [
    ...(showPlaces ? PLACE_KINDS : []),
    ...(showCrowd ? ["busy"] : []),
    ...(showBars ? ["bar"] : []),
  ];
  const live = useLiveLayers(city.scenario ? null : box, wantedKinds, showLighting);
  const source: LayerData = city.scenario ? recording?.layers ?? EMPTY_LAYERS : live.layers;
  const layers: LayerData = useMemo(() => ({
    ...source,
    spots: source.spots.filter((spot) => PLACE_KINDS.includes(spot.kind)),
  }), [source]);
  const crowd = useMemo(
    () => source.spots.filter((spot) => CROWD_KINDS.includes(spot.kind) && ((spot.kind === "busy" && showCrowd) || (spot.kind === "bar" && showBars))),
    [source, showCrowd, showBars],
  );
  const police = usePoliceFigures(official, box);

  const extent = useMemo(() => {
    const days = ev.reports.flatMap((report) => [day(report.at), ...(report.atUntil ? [day(report.atUntil)] : [])]).sort();
    return { from: days[0] ?? "2024-03-21", to: days[days.length - 1] ?? new Date().toISOString().slice(0, 10) };
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
    return ev.reports.filter((report) => (
      types.includes(reportType(report.category)) && whens.includes(whenOf(report)) && inDates(report, dates.from, dates.to)
    ));
  }, [ev.reports, community, types, whens, dates]);

  const inSelection = (report: Report) => districts.length === 0 || districts.includes(where.get(report.id) ?? "");
  const inMonth = (report: Report) => month === null || (exactDay(report) && day(report.at).slice(0, 7) === month);
  const inFocus = (report: Report) => focus === null || reportType(report.category) === focus;

  const selectedNames = districts.map((id) => city.districts.find((d) => d.id === id)?.name).filter(Boolean).join(", ");
  const selectionLabel = districts.length === 0 ? `All of ${city.name}` : selectedNames;

  /* ── why it was reported: one stacked bar, three modes ──────────────── */
  const inPeriod = shown.filter(inMonth);
  const selected = inPeriod.filter(inSelection);
  const series = split === "age"
    ? [...AGE_BANDS.map((band, i) => ({ key: band, label: band, colour: `var(--age-${i})` })), { key: "none", label: "Age not given", colour: "var(--unknown)" }]
    : split === "when"
      ? WHEN_BINS.map((bin) => ({ key: bin.id, label: bin.label, colour: WHEN_INK[bin.id] }))
      : [{ key: "all", label: selectionLabel, colour: "var(--report)" }];
  const partOf = (report: Report): string => (split === "age" ? report.age ?? "none" : split === "when" ? whenOf(report) : "all");
  const reasonRows = REPORT_TYPES.filter((type) => types.includes(type.id)).map((type) => {
    const here = selected.filter((report) => reportType(report.category) === type.id);
    return {
      id: type.id,
      label: type.short,
      parts: series.map((s) => here.filter((report) => partOf(report) === s.key).length),
      context: inPeriod.filter((report) => reportType(report.category) === type.id).length,
    };
  });
  const reasonTotal = reasonRows.reduce((sum, row) => sum + row.parts.reduce((a, b) => a + b, 0), 0);

  /* ── when reports were made: small bars ─────────────────────────────── */
  const monthList = useMemo(() => monthKeys(dates.from, dates.to), [dates.from, dates.to]);
  const forMonths = shown.filter((report) => inSelection(report) && inFocus(report));
  const monthBins = monthList.map((key) => {
    const inIt = forMonths.filter((report) => exactDay(report) && day(report.at).slice(0, 7) === key);
    return {
      id: key,
      label: monthLabel(key, true),
      short: monthLabel(key),
      value: inIt.length,
      detail: REPORT_TYPES.map((type) => {
        const n = inIt.filter((report) => reportType(report.category) === type.id).length;
        return n ? <span key={type.id}>{type.short}: {n}</span> : null;
      }),
    };
  });
  const undated = forMonths.filter((report) => !exactDay(report)).length;

  /* ── how people adapt ───────────────────────────────────────────────── */
  const adaptBase = inPeriod.filter(inFocus);
  const adaptSelected = adaptBase.filter(inSelection);
  const answeredAdapt = adaptSelected.filter((r) => r.adjustments?.length).length;
  const adaptRows = ADJUSTMENTS.map((a) => ({
    id: a.id,
    label: a.label,
    value: adaptSelected.filter((r) => r.adjustments?.includes(a.id)).length,
  }))
    .filter((row) => row.value > 0 && row.id !== "none")
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const faded = useMemo(
    () => new Set(shown.filter((report) => !(inMonth(report) && inFocus(report))).map((report) => report.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inMonth/inFocus read month/focus
    [shown, month, focus],
  );

  /* ── the clicked neighbourhood, inline ──────────────────────────────── */
  const areaFacts = useMemo(() => {
    if (districts.length === 0) return null;
    const picked = city.districts.filter((d) => districts.includes(d.id));
    const here = inPeriod.filter(inSelection);
    const roadKm = picked.reduce((sum, d) => sum + (d.roadKm || 0), 0);
    const cityKm = city.districts.reduce((sum, d) => sum + (d.roadKm || 0), 0);
    const inCity = inPeriod.filter((report) => where.get(report.id) !== null).length;
    const share = (key: "lit" | "unlit" | "unknown") => {
      const km = picked.reduce((sum, d) => sum + d.lighting[key] * (d.roadKm || 1), 0);
      return Math.round(km / Math.max(1, picked.reduce((sum, d) => sum + (d.roadKm || 1), 0)));
    };
    return {
      names: picked.map((d) => d.name).join(", "),
      count: here.length,
      cityCount: inCity,
      afterDark: here.filter((r) => whenOf(r) === "dark").length,
      stories: here.filter((r) => r.note).length,
      perKm: roadKm > 0 ? here.length / roadKm : null,
      cityPerKm: cityKm > 0 ? inCity / cityKm : null,
      places: picked.reduce((sum, d) => sum + d.places, 0),
      lit: share("lit"),
      unlit: share("unlit"),
      unknown: share("unknown"),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inSelection reads districts
  }, [districts, inPeriod, city, where]);

  /* ── actions ────────────────────────────────────────────────────────── */
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const pickDistrict = (id: string) => setDistricts((current) => toggle(current, id));
  const pickType = (id: string) => setFocus((current) => (current === id ? null : (id as ReportType)));

  function saveDraft() {
    if (!draft) return;
    const note = draft.note.trim().slice(0, 1000);
    ev.addReport({
      id: newReportId(Date.now(), Math.random()),
      category: draft.type,
      point: draft.point,
      at: new Date().toISOString(),
      source: "community",
      ...(draft.type !== "other" ? { reasons: [draft.type] } : {}),
      ...(draft.when ? { when: draft.when } : {}),
      ...(note ? { note } : {}),
    });
    setDraft(null);
    setAdding(false);
  }

  const topKey = IMPORTANCE_ITEMS.find((item) => item.id === ev.order[0])?.label ?? "";

  return (
    <main className="board explore">
      <BoardHeader
        title="Around me"
        note={<>What people have reported near you, and what is there. Tap a neighbourhood, a bar or a month to filter everything.</>}
      />

      <div className="explore-grid">
        {/* ── filters ─────────────────────────────────────────────────── */}
        <aside className={`card filters${filtersOpen ? " open" : ""}`} aria-label="Filters">
          <button type="button" className="filters-toggle" onClick={() => setFiltersOpen(!filtersOpen)} aria-expanded={filtersOpen}>
            <SlidersHorizontal size={16} aria-hidden /> Filters
            <span className="muted">{city.name} · {selectedNames || "all areas"} · {types.length} of {REPORT_TYPES.length} reasons</span>
          </button>
          <section>
            <h2>Area</h2>
            <select value={city.id} onChange={(event) => ev.setCity(event.target.value)} aria-label="Area">
              {ev.cities.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <h3>Neighbourhood <small className="muted">— or tap it on the map</small></h3>
            {city.districts.map((district) => (
              <label key={district.id} className="check">
                <input type="checkbox" checked={districts.includes(district.id)} onChange={() => pickDistrict(district.id)} />
                <span>{district.name}</span>
              </label>
            ))}
          </section>

          <section>
            <h2>What to show</h2>
            <label className="check">
              <input type="checkbox" checked={community} onChange={() => setCommunity(!community)} />
              <span>Reported places<small>Pointer survey + community reports</small></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={official} onChange={() => setOfficial(!official)} />
              <span>Official crime <em>(optional)</em><small>Police figures per neighbourhood</small></span>
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
          </section>

          <section>
            <h2>Why it was reported</h2>
            {REPORT_TYPES.map((type) => (
              <label key={type.id} className="check">
                <input type="checkbox" checked={types.includes(type.id)} onChange={() => setTypes(toggle(types, type.id))} />
                <span>{type.label}</span>
              </label>
            ))}
          </section>

          <section>
            <h2>When it feels this way</h2>
            {WHEN_BINS.map((bin) => (
              <label key={bin.id} className="check">
                <input type="checkbox" checked={whens.includes(bin.id)} onChange={() => setWhens(toggle(whens, bin.id))} />
                <span>{bin.label}</span>
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
            <h2>On the map</h2>
            <label className="check">
              <input type="checkbox" checked={showLighting} onChange={() => setShowLighting(!showLighting)} />
              <span>Lit — street lighting is mapped</span>
              <Swatch colour="var(--lit)" round />
            </label>
            <label className="check">
              <input type="checkbox" checked={showPlaces} onChange={() => setShowPlaces(!showPlaces)} />
              <span>Places to go in<small>Station, supermarket, pharmacy, police…</small></span>
              <span className="heart" aria-hidden>♥</span>
            </label>
            <h3>Crowd</h3>
            <label className="check">
              <input type="checkbox" checked={showCrowd} onChange={() => setShowCrowd(!showCrowd)} />
              <span>Busy streets &amp; squares<small>Pedestrian streets — people likely about</small></span>
              <span className="crowd-mark" aria-hidden>+</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={showBars} onChange={() => setShowBars(!showBars)} />
              <span>Bars, pubs &amp; cafés<small>A crowd too — but not every crowd feels the same</small></span>
              <span className="bar-mark" aria-hidden />
            </label>
            {!city.scenario && (showPlaces || showLighting || showCrowd || showBars) && live.error && <p className="note warn">{live.error}</p>}
          </section>

          <section>
            <button type="button" className="section-toggle" onClick={() => setShadeOpen(!shadeOpen)} aria-expanded={shadeOpen}>
              <h2>How the dots are shaded</h2>
              <ChevronDown size={16} aria-hidden className={shadeOpen ? "flip" : undefined} />
            </button>
            {!shadeOpen && <p className="note"><RankDot rank={0} /> Darkest: {topKey.toLowerCase()}. Tap to change.</p>}
            {shadeOpen && <ImportancePanel />}
          </section>
        </aside>

        {/* ── the map ─────────────────────────────────────────────────── */}
        <section className="card map-card">
          <div className="card-head">
            <h2>{city.name} — reported places</h2>
            <Key items={[
              { swatch: <span className="rank-ramp" aria-hidden>{[0, 2, 4].map((r) => <RankDot key={r} rank={r} />)}</span>, label: "Reported place (darker = more serious)" },
              { swatch: <span className="heart" aria-hidden>♥</span>, label: "Place to go in" },
              { swatch: <i className="sw sw-area" aria-hidden />, label: districts.length ? selectionLabel : "Tap a neighbourhood" },
            ]} />
            <button type="button" className={`btn-small${adding ? " on" : ""}`} onClick={() => { setAdding(!adding); setDraft(null); }}>
              {adding ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Report a place</>}
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
              crowd={crowd}
              order={ev.order}
              police={official ? police.areas : []}
              openReport={openReport}
              onOpenReport={setOpenReport}
              adding={adding}
              onAdd={(point) => setDraft({ point, type: "environment", when: "", note: "" })}
              onTiles={setTilesOk}
            />
            {!tilesOk && <p className="map-banner">The basemap did not load — the records are still drawn where they are.</p>}
            {ev.reportsLoading && <p className="map-banner">Loading the reported places…</p>}
            {adding && !draft && <p className="map-banner">Tap the place on the map.</p>}
            {draft && (
              <form className="draft" onSubmit={(event) => { event.preventDefault(); saveDraft(); }}>
                <b>Report this place</b>
                <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ReportType })} aria-label="Why">
                  {REPORT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                </select>
                <select value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value as When | "" })} aria-label="When">
                  <option value="">When? (optional)</option>
                  {WHEN_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                <textarea value={draft.note} maxLength={1000} placeholder="What is it like here? (optional)" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
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
              <span>Tap a dot to read what the respondent said.</span>
              {official && <span><i className="sw sw-dashed" aria-hidden /> Official crime: neighbourhood figures</span>}
              {showCrowd && <span><span className="crowd-mark">+</span> Busy street</span>}
              {showBars && <span><span className="bar-mark" /> Bar or café</span>}
            </div>
          </div>
        </section>

        {/* ── why: one stacked bar, three modes ───────────────────────── */}
        <section className="card types-card">
          <div className="card-head">
            <h2>Why it was reported</h2>
            {focus && <button type="button" className="link" onClick={() => setFocus(null)}>Clear</button>}
          </div>
          <div className="segmented" role="group" aria-label="Split the bars">
            {SPLITS.map((option) => (
              <button key={option.id} type="button" aria-pressed={split === option.id} onClick={() => setSplit(option.id)}>{option.label}</button>
            ))}
          </div>
          <p className="card-sub">
            {selectionLabel}{month ? `, ${monthLabel(month, true)}` : ""}. Tap a bar to show only that reason; hover for the numbers.
          </p>
          <StackBars
            rows={reasonRows}
            series={series}
            focus={focus}
            onPick={pickType}
            axisLabel="Reported places"
            total={reasonTotal}
            selectionLabel={selectionLabel}
          />
          {split !== "none" && (
            <Key items={series.filter((s) => reasonRows.some((row) => (row.parts[series.indexOf(s)] ?? 0) > 0)).map((s) => ({ swatch: <Swatch colour={s.colour} />, label: s.label }))} />
          )}
        </section>

        <div className="explore-below">
          {/* ── the neighbourhood you tapped ─────────────────────────────── */}
          {areaFacts && (
            <section className="card area-facts">
              <div className="card-head">
                <h2>{areaFacts.names}</h2>
                <button type="button" className="link" onClick={() => setDistricts([])}>Clear</button>
              </div>
              <dl className="facts">
                <dt>Reported places</dt>
                <dd><b>{areaFacts.count.toLocaleString("en-GB")}</b> ({pct(areaFacts.count, areaFacts.cityCount)} of {city.name})</dd>
                <dt>Mostly after dark</dt>
                <dd>{areaFacts.afterDark} ({pct(areaFacts.afterDark, areaFacts.count)})</dd>
                <dt>With a story</dt>
                <dd>{areaFacts.stories}</dd>
                {areaFacts.perKm !== null && (
                  <>
                    <dt>Per km of road</dt>
                    <dd>{areaFacts.perKm.toFixed(1)}{areaFacts.cityPerKm !== null && <span className="muted"> · city {areaFacts.cityPerKm.toFixed(1)}</span>}</dd>
                  </>
                )}
                <dt>Lighting</dt>
                <dd>{areaFacts.lit}% lit <span className="muted">· {areaFacts.unlit}% unlit · {areaFacts.unknown}% unknown lighting</span></dd>
                <dt>Places to go in</dt>
                <dd>{areaFacts.places}</dd>
              </dl>
              <div className="mini-share" aria-hidden>
                <i style={{ width: `${areaFacts.lit}%`, background: "var(--lit)" }} />
                <i style={{ width: `${areaFacts.unlit}%`, background: "var(--unlit)" }} />
                <i className="sw-hatch" style={{ width: `${areaFacts.unknown}%` }} />
              </div>
              <p className="note">Counts, not a rating: more reported places can mean more people answered the survey here.{city.figures === "osm" ? "" : " Lighting and place figures are not measured yet."}</p>
            </section>
          )}

          {/* ── when reports were made ───────────────────────────────────── */}
          <section className="card">
            <div className="card-head">
              <h2>When places were reported</h2>
              {month && <button type="button" className="link" onClick={() => setMonth(null)}>Clear</button>}
            </div>
            <p className="card-sub">
              Reports per month — when the survey was filled in, not when anything happened. Tap a month to filter.
              {undated > 0 && <> {undated.toLocaleString("en-GB")} reported during a window with no day are not drawn.</>}
            </p>
            <MonthBars bins={monthBins} focus={month} onPick={(id) => setMonth((current) => (current === id ? null : id))} yLabel="Reported places" />
          </section>

          {/* ── how people adapt ─────────────────────────────────────────── */}
          <section className="card">
            <div className="card-head"><h2>What people do about it</h2></div>
            <p className="card-sub">
              &ldquo;Do you change your behaviour because of this place?&rdquo; — {answeredAdapt.toLocaleString("en-GB")} answered,
              {" "}several answers allowed. Percentages are of those who answered.
            </p>
            {answeredAdapt > 0 ? (
              <ShareBars rows={adaptRows} of={answeredAdapt} ofLabel={`the ${answeredAdapt.toLocaleString("en-GB")} who answered`} labelWidth={240} />
            ) : (
              <p className="empty">Nobody in this selection answered this question.</p>
            )}
          </section>
        </div>
      </div>

      <p className="caveat">Reported places are what respondents told a survey, not incident risk. Missing lighting stays unknown.</p>
      <Sources />
    </main>
  );
}
