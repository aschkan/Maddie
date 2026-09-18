"use client";

/**
 * The Research tab — the interviews, and what they add up to.
 *
 * Two halves, in this order on purpose:
 *
 *   1. **What the cohort said, aggregated.** The §4 printed-list tally, the §6
 *      split on official versus lived, §8's presentation preferences. These are
 *      the numbers a requirements chapter is built from, so they go first.
 *   2. **The participants themselves**, expandable one at a time.
 *
 * ⚠ Everything on this screen may be synthetic, and three things say so — the
 * banner at the top, the `SYNTHETIC` tag as the first line of every card, and
 * the count in the banner. That is the same arrangement the map uses for
 * example reports, for the same reason: a quote lifted off this screen into a
 * document has to carry its marking with it, because this is the last place
 * anybody can still catch it. None of the three is decoration.
 *
 * The one presentational decision worth defending: the cue tallies are shown
 * **as the participants said them, uncoded**, and the panel says so. Grouping
 * "no lighting in the park" with "unlit stretches" is qualitative CODING — a
 * research step with a method and an audit trail behind it — and a tool that
 * did it silently with string matching would be inventing findings. So the
 * list is long and repetitive, which is what raw cues look like.
 */

import { useMemo, useState } from "react";

import {
  PRESENTATION_LABEL, countExampleInterviews,
  tallyContribution, tallyCues, tallyPlaces, tallyPresentation, tallySources,
  type Interview,
} from "@/lib/interviews";
import type { InterviewBackend } from "@/components/useInterviews";

interface Props {
  interviews: Interview[];
  backend: InterviewBackend;
  error: string | null;
  loading: boolean;
}

/** A labelled list, or nothing at all when there is nothing to say. */
function Bullets({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="iv-block">
      <h5>{title}</h5>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );
}

/** A labelled paragraph, dropped entirely when the answer was empty. */
function Says({ title, text }: { title: string; text: string }) {
  if (!text) return null;
  return (
    <div className="iv-block">
      <h5>{title}</h5>
      <p className="iv-quote">{text}</p>
    </div>
  );
}

/** One participant, collapsed to a summary line until asked for. */
function Card({ interview }: { interview: Interview }) {
  const one = interview;
  const demo = one.demographics;
  return (
    <details className="iv-card">
      <summary>
        <span className="iv-code">{one.code}</span>
        <span className="iv-who">
          {demo.ageBand} · {demo.city} · {demo.mainMode}
        </span>
      </summary>

      {/* First line inside, before any answer is read: what kind of thing
          this is. Same device as EXAMPLE DATA on a report popup. */}
      {one.source === "example" && (
        <p className="iv-tag">SYNTHETIC — NOBODY SAID THIS</p>
      )}

      <dl className="iv-demo">
        <dt>Occupation</dt><dd>{demo.occupation}</dd>
        <dt>In the Netherlands</dt><dd>{demo.yearsInNL}</dd>
        <dt>Knows the area</dt><dd>{demo.familiarity}</dd>
        <dt>Out alone</dt><dd>{demo.soloFrequency}</dd>
        <dt>Sitting</dt>
        <dd>{new Date(one.conductedAt).toLocaleDateString()} · {one.durationMin} min</dd>
        <dt>Identity (optional, §10)</dt>
        {/* "Skipped" rather than blank: the protocol says this item may be
            skipped, so a skip is an answer and must not read as missing data. */}
        <dd>{demo.identityNote ?? <em>skipped</em>}</dd>
      </dl>

      <Says title="§2 How they get around" text={one.mobility.everyday} />
      <Bullets title="§2 Used that day" items={one.mobility.appsThatDay} />
      <Says title="§2 What it did well" text={one.mobility.worked} />
      <Says title="§2 What was lacking" text={one.mobility.lacked} />

      <Says title="§3 The decision" text={one.decision.situation} />
      {one.decision.general && (
        <p className="iv-note">
          No specific instance recalled — §3&rsquo;s fallback was used and this is a general
          reflection.
        </p>
      )}
      <Bullets title="§3 What made it feel that way" items={one.decision.whatMadeIt} />
      <Says title="§3 Options weighed" text={one.decision.optionsWeighed} />
      <Says title="§3 What changed afterwards" text={one.decision.changedAfter} />

      <Bullets title="§4 Feels safe — said unprompted" items={one.cues.safeSpontaneous} />
      <Bullets title="§4 Feels safe — added after prompting" items={one.cues.safePrompted} />
      <Bullets title="§4 Feels unsafe" items={one.cues.unsafe} />
      <Says title="§4 Trade-offs" text={one.tradeOff} />
      <Bullets title="§4 Places they added themselves" items={one.ownPlaces} />
      <Bullets title="§4 Would actually use" items={one.wouldUse} />
      <Bullets title="§4 Would not help at all" items={one.wouldNotHelp} />
      <Says title="§4 Time of day" text={one.timeOfDay} />

      <Says title="§5 What they look for now" text={one.current.infoSought} />
      <Says title="§5 What was missing" text={one.current.missingInfo} />
      <Bullets title="§5 Tools used" items={one.current.tools} />
      <Says title="§5 Frustrations" text={one.current.frustrations} />

      <Bullets title="§6 Would want from a tool" items={one.needs.wanted} />
      <Says title="§6 Would trust most" text={one.needs.trustMost} />
      <Says title="§6 Sceptical of" text={one.needs.sceptical} />
      <Says
        title={`§6 Official or lived — ${one.needs.officialOrLived}`}
        text={one.needs.officialOrLivedWhy}
      />
      <Says
        title={`§6 Would contribute — ${one.needs.wouldContribute ? "yes" : "no"}`}
        text={one.needs.contributeLimits}
      />
      <Says title="§6 Explanation that would help" text={one.needs.explanationWanted} />
      <Bullets title="§6 Wants taken into account" items={one.needs.personalFactors} />
      {one.needs.prefersNeutral && (
        <p className="iv-note">
          Prefers neutral, identical information and would rather not hand over personal data.
        </p>
      )}

      <Bullets title="§7 Concerns" items={one.concerns.concerns} />
      <Says title="§7 Possible downside" text={one.concerns.downside} />
      <Says title="§7 Would stop them using it" text={one.concerns.dealBreaker} />

      <Bullets
        title="§8 How it should be shown"
        items={one.presentation.forms.map((form) => PRESENTATION_LABEL[form])}
      />
      <Bullets title="§8 Would compare on" items={one.presentation.compareOn} />
      <Says title="§8 Detail wanted" text={one.presentation.detail} />
      <Says title="§8 Their own idea" text={one.presentation.ownIdea} />

      <Says title="§9 Anything else" text={one.closing} />

      {one.interviewerNote && (
        <div className="iv-block">
          <h5>Interviewer note</h5>
          <p className="iv-note">{one.interviewerNote}</p>
        </div>
      )}
      {one.rq.length > 0 && <p className="iv-rq">Evidence for {one.rq.join(", ")}</p>}
    </details>
  );
}

export default function ResearchPanel({ interviews, backend, error, loading }: Props) {
  const examples = useMemo(() => countExampleInterviews(interviews), [interviews]);
  const places = useMemo(() => tallyPlaces(interviews), [interviews]);
  // `tallySources` rather than a loop here: one implementation of the split,
  // in the tested module, so the panel and any future export cannot disagree.
  const sources = useMemo(() => tallySources(interviews), [interviews]);
  const presentation = useMemo(() => tallyPresentation(interviews), [interviews]);
  const contribution = useMemo(() => tallyContribution(interviews), [interviews]);
  const unsafeCues = useMemo(() => tallyCues(interviews, "unsafe"), [interviews]);
  const [showCues, setShowCues] = useState(false);

  if (loading) return <p className="hint">Loading the interviews…</p>;
  if (error) return <p className="error">{error}</p>;

  if (backend === "none") {
    return (
      <p className="filter-note">
        No database is configured on this deployment, so there are no interviews to show.
        Interviews are not kept in the browser — they are transcripts of a sitting, not
        something this page could have produced. Set <code>MONGO_URI</code> and run{" "}
        <code>npm run seed</code> to load the synthetic cohort.
      </p>
    );
  }

  if (interviews.length === 0) {
    return (
      <p className="filter-note">
        No interviews are loaded. <code>npm run seed</code> writes a synthetic cohort so this
        panel can be seen working before the fieldwork is done.
      </p>
    );
  }

  return (
    <div className="research">
      {examples > 0 && (
        /* Loud, and it stays until the data is gone — the same contract as the
           example-data banner on the crime layer. These are invented
           participants answering invented questions; the only thing between a
           quote from here and a findings chapter is that the screen says so. */
        <div className="example-banner">
          <strong>{examples} of these {examples === 1 ? "interview is" : "interviews are"} synthetic.</strong>{" "}
          Generated by <code>npm run seed</code> so this panel can be seen working before the
          interviews are done. Nobody said any of it, no participant exists, and the numbers
          below are shaped to exercise the screen rather than measured from anything. Do not
          quote them.
          <br />
          Clear with <code>npm run seed -- --no-demo</code>.
        </div>
      )}

      <p className="filter-note">
        {interviews.length} sitting{interviews.length === 1 ? "" : "s"}, following the
        semi-structured protocol. The section numbers on each answer are the protocol&rsquo;s own,
        so a card can be read beside the instrument.
      </p>

      {/* ── §4 the printed list ─────────────────────────────────────────── */}
      <details className="filter" open>
        <summary>§4 &mdash; the printed list of places</summary>
        <p className="filter-note">
          Every participant is handed the same printed list and asked about each place
          explicitly, which is what makes these columns comparable at all.{" "}
          <strong>No difference is an answer</strong>, not a missing one — a place that changes
          nothing is a finding about that place.
        </p>
        <table className="iv-table">
          <thead>
            <tr>
              <th>Place</th>
              <th>Safer</th>
              <th>No diff.</th>
              <th>Less safe</th>
            </tr>
          </thead>
          <tbody>
            {places.map((row) => (
              <tr key={row.place.id}>
                <th scope="row">
                  {row.place.label}
                  {/* Which map layer this answer is about, where there is one.
                      That join is what lets an interview say something about
                      the checkboxes in the Layers tab. */}
                  {row.place.spot === null && <small> no map layer</small>}
                </th>
                <td>{row.safer}</td>
                <td>{row.noDifference}</td>
                <td className={row.lessSafe > 0 ? "iv-warn" : ""}>{row.lessSafe}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="filter-note">
          A place several participants call <strong>less safe</strong> is the one worth reading
          twice — it means showing it as a &ldquo;safe spot&rdquo; would be actively wrong for
          them, not merely unhelpful.
        </p>
      </details>

      {/* ── §6 where the information should come from ───────────────────── */}
      <details className="filter" open>
        <summary>§6 &mdash; official figures or lived experience</summary>
        <div className="bands">
          <span className="band band-low">both {sources.both ?? 0}</span>
          <span className="band band-medium">lived only {sources.lived ?? 0}</span>
          <span className="band band-high">official only {sources.official ?? 0}</span>
          <span className="band band-highest">neither {sources.neither ?? 0}</span>
        </div>
        <p className="filter-note">
          And on contributing their own experiences: <strong>{contribution.yes} would</strong>,{" "}
          {contribution.no} would not. That split is load-bearing for this app — the community
          layer starts empty and only fills if people are willing to write in it.
        </p>
      </details>

      {/* ── §8 how it should be presented ──────────────────────────────── */}
      <details className="filter" open>
        <summary>§8 &mdash; how it should be shown</summary>
        <table className="iv-table">
          <tbody>
            {presentation.map((row) => (
              <tr key={row.form}>
                <th scope="row">{PRESENTATION_LABEL[row.form]}</th>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="filter-note">
          §8&rsquo;s own note warns that people anchor on designs they have already seen, so a
          strong preference for a map may say more about what exists than about what would
          help.
        </p>
      </details>

      {/* ── the raw cues ───────────────────────────────────────────────── */}
      <details className="filter">
        <summary>§4 &mdash; unsafe cues, as said</summary>
        <p className="filter-note">
          <strong>Uncoded.</strong> These are the participants&rsquo; own words, counted
          verbatim. Grouping &ldquo;no lighting in the park&rdquo; with &ldquo;unlit
          stretches&rdquo; is qualitative coding — a research step with a method behind it — and
          doing it here with string matching would manufacture findings. So the list is long and
          repetitive, which is what raw cues look like.
        </p>
        <button type="button" className="link" onClick={() => setShowCues((on) => !on)}>
          {showCues ? "Hide" : `Show all ${unsafeCues.length}`}
        </button>
        {showCues && (
          <ul className="iv-cues">
            {unsafeCues.map((row) => (
              <li key={row.cue}><span className="iv-n">{row.total}</span> {row.cue}</li>
            ))}
          </ul>
        )}
      </details>

      {/* ── the participants ───────────────────────────────────────────── */}
      <h4 className="iv-heading">Participants</h4>
      {interviews.map((one) => <Card key={one.id} interview={one} />)}
    </div>
  );
}
