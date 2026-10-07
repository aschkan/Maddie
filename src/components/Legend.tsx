"use client";

/**
 * The legend — every colour, shape and texture the map can show, and what each
 * one means. On the map, not in a tab.
 *
 * The supervisor's three requirements, each load-bearing:
 *
 *   * **Every POSSIBLE state, not just the ones on screen.** A route that came
 *     out all teal says nothing unless you know it could have been orange, rust
 *     or grey. So every group lists every value it can take, always.
 *   * **An info button per group**, for how it was worked out — on demand, not
 *     on the first screen. The answer to "based on what?" is one tap away and
 *     never in the way.
 *   * **Layers you can see at once.** Each group's switch is HERE, beside its
 *     key, so turning the lighting on while looking at the route does not mean
 *     leaving the route. The Layers tab holds the same switches with more
 *     detail; the two are one state, not two copies.
 *
 * The swatches are drawn with the same tokens as the map (`palette.ts`), so the
 * key cannot drift from the thing it is the key to.
 */

import { useState, type ReactNode } from "react";

import {
  ALTERNATIVE, ALTERNATIVE_OPACITY, END, LIGHT, PLACE, POLICE, REPORT, ROUTE, START,
  pick, type Tone,
} from "@/lib/palette";
import { AGE_OPACITY } from "@/lib/reports";
import type { Verdict } from "@/lib/score";
import { FAIR_FROM, GOOD_FROM, VERDICT_EXPLAIN, VERDICT_LABEL } from "@/lib/verdict";

export type LayerId = "lighting" | "places" | "reports" | "police";

interface Props {
  tone: Tone;
  open: boolean;
  onOpen: (open: boolean) => void;
  shown: Record<LayerId, boolean>;
  onShow: (layer: LayerId, on: boolean) => void;
  /** "22:00 is after dark" — why the map is the colour it is. */
  skyNote: string;
  /** Opens the tab that explains or changes a group, for the "more" links. */
  onOpenTab: (tab: "safety" | "layers" | "reports") => void;
}

const VERDICTS: Verdict[] = ["good", "fair", "poor", "unknown"];

/** A short stroke of route, as the map draws it. */
function Stroke({ colour, dashed = false, opacity = 1, glow, width = 6 }: {
  colour: string; dashed?: boolean; opacity?: number; glow?: { colour: string; strength: number }; width?: number;
}) {
  return (
    <svg width="40" height="18" viewBox="0 0 40 18" aria-hidden="true" className="lg-swatch">
      {glow && glow.strength > 0 && (
        <line x1="5" y1="9" x2="35" y2="9" stroke={glow.colour} strokeWidth="16"
              strokeLinecap="round" strokeOpacity={0.5 * glow.strength} />
      )}
      <line x1="5" y1="9" x2="35" y2="9" stroke={colour} strokeWidth={width}
            strokeOpacity={opacity} strokeLinecap={dashed ? "butt" : "round"}
            strokeDasharray={dashed ? "2 6" : undefined} />
    </svg>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg width="40" height="22" viewBox="0 0 40 22" aria-hidden="true" className="lg-swatch">
      {children}
    </svg>
  );
}

function Row({ swatch, label, sub }: { swatch: ReactNode; label: string; sub?: string }) {
  return (
    <li className="lg-row">
      {swatch}
      <span className="lg-text">
        {label}
        {sub && <small>{sub}</small>}
      </span>
    </li>
  );
}

function Group({
  title, info, layer, shown, onShow, children, more,
}: {
  title: string;
  info: ReactNode;
  layer?: LayerId;
  shown?: Record<LayerId, boolean>;
  onShow?: (layer: LayerId, on: boolean) => void;
  children: ReactNode;
  more?: ReactNode;
}) {
  const [explain, setExplain] = useState(false);
  const on = layer && shown ? shown[layer] : true;
  return (
    <section className={on ? "lg-group" : "lg-group is-off"}>
      <header className="lg-head">
        <h3>{title}</h3>
        <button
          type="button"
          className="lg-info"
          aria-expanded={explain}
          aria-label={`How "${title}" is worked out`}
          onClick={() => setExplain(!explain)}
        >
          i
        </button>
        {layer && onShow && (
          <label className="switch" title={on ? "Hide on the map" : "Show on the map"}>
            <input
              type="checkbox"
              checked={on}
              onChange={(event) => onShow(layer, event.target.checked)}
              aria-label={`Show ${title} on the map`}
            />
            <span aria-hidden="true" />
          </label>
        )}
      </header>
      {explain && <div className="lg-explain">{info}{more}</div>}
      <ul>{children}</ul>
    </section>
  );
}

export default function Legend({ tone, open, onOpen, shown, onShow, skyNote, onOpenTab }: Props) {
  const ink = pick(END, tone);
  const ground = tone === "night" ? "#0b0d12" : "#ffffff";
  const light = pick(LIGHT, tone);
  const blue = pick(REPORT, tone);
  const bubblePath = "M9 5A3 3 0 0 1 12 2h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-6l-4 4v-4a3 3 0 0 1-3-3z";

  if (!open) {
    return (
      <button type="button" className={`legend-toggle tone-${tone}`} onClick={() => onOpen(true)} aria-expanded={false}>
        <span aria-hidden="true" className="legend-dots">
          <i style={{ background: pick(ROUTE.good, tone) }} />
          <i style={{ background: light }} />
          <i style={{ background: pick(PLACE, tone) }} />
          <i style={{ background: blue }} />
        </span>
        Legend
      </button>
    );
  }

  return (
    <aside className={`legend tone-${tone}`} aria-label="Map legend">
      <header className="legend-top">
        <h2>What the map shows</h2>
        <button type="button" className="icon ghost" onClick={() => onOpen(false)} aria-label="Close the legend">✕</button>
      </header>
      <p className="lg-sky">{skyNote}</p>

      <Group
        title="Your trip"
        info={<p>A is where you start and B where you are going. They are black, white and grey on purpose:
          colour on this map is kept for what it says about the streets, and your own trip is not evidence of anything.
          Every other way round is drawn faded — tap one to compare it.</p>}
      >
        <Row
          swatch={<Glyph><circle cx="20" cy="11" r="8" fill={ground} stroke={pick(START, tone)} strokeWidth="2.5" />
            <text x="20" y="14.6" textAnchor="middle" fontSize="9" fontWeight="700" fill={pick(START, tone)}>A</text></Glyph>}
          label="Start"
        />
        <Row
          swatch={<Glyph><path d="M20 21C20 21 28 13 28 8.5A8 8 0 1 0 12 8.5C12 13 20 21 20 21z" fill={ink} />
            <text x="20" y="11.5" textAnchor="middle" fontSize="8" fontWeight="800" fill={ground}>B</text></Glyph>}
          label="Destination"
        />
        <Row swatch={<span className="lg-pill is-preferred">★</span>} label="★ Preferred — the way round we suggest"
             sub="When one route reads clearly better than the rest. Often none does — then nothing is starred." />
        <Row swatch={<Stroke colour={pick(ALTERNATIVE, tone)} opacity={ALTERNATIVE_OPACITY} width={5} />}
             label="Another way round" sub="Tap it on the map to compare." />
      </Group>

      <Group
        title="How the route reads"
        info={<>
          <p>Each stretch of about 400 m is coloured by what OpenStreetMap records along it, at the hour you chose:
            lit or unlit streets, street lamps, shops and cafés, parkland, underpasses.</p>
          <p>{VERDICT_LABEL.good} is a score of {GOOD_FROM} or more out of 100, {VERDICT_LABEL.fair} is {FAIR_FROM}–{GOOD_FROM - 1},
            {" "}{VERDICT_LABEL.poor} is under {FAIR_FROM}. It is a reading of the map, not a promise about the street —
            and it never includes the reports or the police figures, which are shown beside it.</p>
        </>}
        more={<button type="button" className="link-quiet" onClick={() => onOpenTab("safety")}>Why this route? →</button>}
      >
        {VERDICTS.map((verdict) => (
          <Row
            key={verdict}
            swatch={<Stroke colour={pick(ROUTE[verdict], tone)} dashed={verdict === "unknown"} />}
            label={verdict === "unknown" ? `${VERDICT_LABEL.unknown}, or still reading` : VERDICT_LABEL[verdict]}
            sub={VERDICT_EXPLAIN[verdict]}
          />
        ))}
      </Group>

      <Group
        title="Light"
        layer="lighting" shown={shown} onShow={onShow}
        info={<p>From OpenStreetMap: streets tagged <code>lit=yes</code> and individually mapped street lamps. Most
          streets carry no lighting tag at all, so a stretch with no glow may simply be unmapped — it is not
          necessarily dark. The glow around your route is as strong as the share of that stretch mapped as lit.</p>}
      >
        <Row swatch={<Stroke colour={pick(ROUTE.good, tone)} glow={{ colour: light, strength: 1 }} />}
             label="Strong glow — mostly lit" />
        <Row swatch={<Stroke colour={pick(ROUTE.good, tone)} glow={{ colour: light, strength: 0.45 }} />}
             label="Faint glow — partly lit" />
        <Row swatch={<Stroke colour={pick(ROUTE.good, tone)} />} label="No glow — unlit, or not mapped"
             sub="The Safety tab says which." />
        <Row swatch={<Stroke colour={light} width={2.5} opacity={0.8} />} label="A lit street" />
        <Row swatch={<Glyph><circle cx="14" cy="11" r="2.4" fill={light} /><circle cx="22" cy="11" r="2.4" fill={light} />
          <circle cx="30" cy="11" r="2.4" fill={light} /></Glyph>} label="Street lamps" />
      </Group>

      <Group
        title="Places to go"
        layer="places" shown={shown} onShow={onShow}
        info={<p>Somewhere with a door, a light and usually a person — a station, a hospital, a late shop, a
          bar. One heart for all of them; hover or zoom in to see which kind. Places to walk towards, not places
          guaranteed to help: opening hours are shown as mapped.</p>}
        more={<button type="button" className="link-quiet" onClick={() => onOpenTab("layers")}>Choose which places count →</button>}
      >
        <Row
          swatch={<Glyph><path d="M20 19.5S11 14 11 8.6A4.9 4.9 0 0 1 20 5.8 4.9 4.9 0 0 1 29 8.6C29 14 20 19.5 20 19.5z"
            fill={pick(PLACE, tone)} stroke={ground} strokeWidth="1.2" /></Glyph>}
          label="A place to go" sub="🚉 🏥 🛡️ 🛒 ☕ … on hover or close zoom"
        />
      </Group>

      <Group
        title="Reports"
        layer="reports" shown={shown} onShow={onShow}
        info={<p>Things people entered: harassment, catcalling, theft and the like. One person, one place, one
          time. Older reports fade. They are never part of the route reading — they sit beside it so you can weigh
          them yourself. An empty map means nobody wrote anything down, not that nothing happened.</p>}
        more={<button type="button" className="link-quiet" onClick={() => onOpenTab("reports")}>Filter or add a report →</button>}
      >
        {(["recent", "year", "older"] as const).map((age) => (
          <Row
            key={age}
            swatch={<Glyph><path d={bubblePath} fill={blue} fillOpacity={AGE_OPACITY[age]} stroke={ground} strokeWidth="1" /></Glyph>}
            label={age === "recent" ? "A report, last 3 months" : age === "year" ? "Within the last year" : "Older than a year"}
          />
        ))}
      </Group>

      <Group
        title="Police figures"
        layer="police" shown={shown} onShow={onShow}
        info={<p>Offences recorded by the police, from CBS, counted for a whole neighbourhood per month. Drawn as a
          hatch over the whole area because that is all the figure can say — it cannot tell one street from the
          next, and it never changes the route reading. More recorded offences does not make a street worse to walk:
          reporting, footfall and policing all move these numbers.</p>}
      >
        {(["low", "medium", "high", "highest"] as const).map((band, index) => (
          <Row
            key={band}
            swatch={<Glyph>
              <rect x="6" y="3" width="28" height="16" rx="3" fill={`url(#hatch-${band})`}
                    stroke={pick(POLICE, tone)} strokeOpacity="0.6" />
            </Glyph>}
            label={["Fewer recorded offences", "Around the middle", "More recorded offences", "Most recorded offences"][index] ?? band}
          />
        ))}
      </Group>
    </aside>
  );
}
