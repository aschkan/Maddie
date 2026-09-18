/**
 * The requirements interviews — the study's own data, shaped by the protocol.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EVERYTHING HERE IS SYNTHETIC UNTIL REAL INTERVIEWS REPLACE IT, AND IT    │
 * │ LIVES IN ITS OWN COLLECTION SO A FAKE CAN NEVER SIT BESIDE REAL         │
 * │ TESTIMONY.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `seed-data.ts` already says why that matters and this is the same rule, one
 * object further out: invented first-person testimony is exactly the material
 * the real interviews will supply, and a convincing fake of it in the same
 * place is how a fake ends up quoted as a finding. Two things follow, and
 * neither is decoration:
 *
 *   * **A different collection from `reports`.** `INTERVIEWS`, never `REPORTS`.
 *     The crime layer holds what people typed about a place; this holds what a
 *     participant said in a 30–45 minute sitting. They are different objects
 *     with different consent behind them, and the reason the seed can write
 *     this at all is that nothing here is pretending to be a report.
 *   * **`source` is carried per record and the UI keys off it**, the same way
 *     the map keys off `source: "example"` — a banner on the panel, a tag as
 *     the first line of every card, and a count of how many are invented. A
 *     synthetic quote that reaches a slide deck has to carry its marking with
 *     it, because that is the only point at which anybody can still catch it.
 *
 * The shape follows `Interview_Protocol_Revised_3` section for section, because
 * a store shaped like the instrument is one that real transcripts can be typed
 * into later without a migration:
 *
 *   §2  warm-up, everyday mobility        → `mobility`
 *   §3  personal decision-making          → `decision`
 *   §4  understanding safety decisions    → `cues`, `tradeOff`, `placeRatings`,
 *                                           `timeOfDay`
 *   §5  information used and current tools→ `current`
 *   §6  information needs for a tool      → `needs`
 *   §7  concerns, trust, downsides        → `concerns`
 *   §8  how should it be presented        → `presentation`
 *   §9  closing                           → `closing`
 *   §10 demographics                      → `demographics`
 *
 * The research questions the protocol maps onto are carried too (`rq`), because
 * §"Relationship to the Research Questions" is what makes an answer evidence
 * for something rather than a nice quote.
 *
 * Pure. No database, no clock, no `Math.random`. `test/interviews.test.ts`
 * pins it.
 */

/** Who produced a record. Never inferred — see `parseInterviews`. */
export type InterviewSource = "example" | "fieldwork";

/**
 * What a participant said about one of the protocol's printed places.
 *
 * §4 hands the participant a printed list and asks for each one explicitly, so
 * that every participant is asked about the same options. Three answers, and
 * `"no-difference"` is a real answer rather than a missing one — a place that
 * changes nothing is a finding about that place, and folding it into "no
 * response" would make every list look unanimous.
 */
export type PlaceVerdict = "safer" | "no-difference" | "less-safe";

export const PLACE_VERDICTS: PlaceVerdict[] = ["safer", "no-difference", "less-safe"];

export const PLACE_VERDICT_LABEL: Record<PlaceVerdict, string> = {
  safer: "Safer",
  "no-difference": "No difference",
  "less-safe": "Less safe",
};

/**
 * The printed list, verbatim from §4, in the protocol's own order.
 *
 * ⚠ The `spot` field is the `SAFE_SPOTS` id in `layers.ts` where there is one.
 * That is the join that makes an interview answer able to say anything about
 * the map: "six of eight participants called a 24/7 gym no help" is a statement
 * about the `gym24` layer. Keep the ids in step with `layers.ts` or the
 * aggregate silently stops lining up with the checkboxes.
 *
 * A place with `spot: null` is one the protocol asks about that the map has no
 * layer for. That is a gap worth seeing rather than hiding — it is exactly the
 * kind of thing a requirements interview is supposed to surface.
 */
export interface ProtocolPlace {
  id: string;
  label: string;
  /** The `SAFE_SPOTS` id this corresponds to, or null if the map has none. */
  spot: string | null;
}

export const PROTOCOL_PLACES: ProtocolPlace[] = [
  { id: "police", label: "Police station", spot: "police" },
  { id: "taxi", label: "Taxi stand", spot: "taxi" },
  { id: "cafe", label: "Open café", spot: "bar" },
  { id: "gym24", label: "24/7 gym", spot: "gym24" },
  { id: "mall", label: "Shopping centre", spot: "mall" },
  { id: "pharmacy", label: "Pharmacy", spot: "pharmacy" },
  { id: "hospital", label: "Hospital", spot: "hospital" },
];

const PLACE_IDS = new Set(PROTOCOL_PLACES.map((place) => place.id));
const VERDICTS = new Set<string>(PLACE_VERDICTS);

/** Which research question an answer is evidence for. §"Relationship to the RQs". */
export type ResearchQuestion = "RQ1" | "RQ2" | "RQ3" | "RQ4";

export interface Demographics {
  /** §10. A band, not an age — a single year is identifying in a small study. */
  ageBand: string;
  city: string;
  /** §10 "How long have you lived in the Netherlands?" as written. */
  yearsInNL: string;
  /** §10 "How familiar are you with the area(s) you usually travel in?" */
  familiarity: string;
  occupation: string;
  mainMode: string;
  /** §10 "How often do you move around the city on your own?" */
  soloFrequency: string;
  /**
   * §10's final, OPTIONAL and sensitive item.
   *
   * Absent means skipped, which the protocol explicitly allows and which the
   * panel renders as "skipped" rather than as an empty string. It is here
   * because the literature review identifies identity-informed differences in
   * safety perception — so a blank and a "no" are different answers.
   */
  identityNote?: string;
}

/** §2 — the warm-up, and the tech used on that specific day. */
export interface MobilitySection {
  /** How they get around on a normal day. */
  everyday: string;
  /** What they used on that specific recent day, if anything. */
  appsThatDay: string[];
  /** What it did well. */
  worked: string;
  /** What they found lacking. `""` when they said nothing was. */
  lacked: string;
}

/** §3 — the difficult decision, and how it was made. */
export interface DecisionSection {
  /**
   * The decision, at the level of a decision.
   *
   * ⚠ Deliberately NOT an incident narrative. §3 asks "how did you make that
   * decision?", and what this study needs is the reasoning — the options, the
   * cues, what changed afterwards. Synthetic incident testimony is the one
   * thing this file must not contain; see the header.
   */
  situation: string;
  /** §3 follow-up: "What specifically made it feel that way?" */
  whatMadeIt: string[];
  /** §3 follow-up: the options weighed, and the information used to choose. */
  optionsWeighed: string;
  /** §3 follow-up: "Did you do anything differently — then, or afterwards?" */
  changedAfter: string;
  /** True when §3's fallback was used: no specific instance, general reflection. */
  general: boolean;
}

/** §4 — the cues, both directions. Symmetric by design. */
export interface CueSection {
  /** Spontaneous, recorded BEFORE any example was offered. */
  safeSpontaneous: string[];
  /** Added only after the interviewer offered §4's prompt list. */
  safePrompted: string[];
  /** §4's symmetric probe: what makes a place feel unsafe. */
  unsafe: string[];
  /**
   * Whether the interviewer had to offer the prompt list at all.
   *
   * §4's note is firm about recording the spontaneous answer in full first, so
   * whether prompting happened is part of the data: an item that only ever
   * appears after prompting is weaker evidence than one volunteered.
   */
  prompted: boolean;
}

/** §5 — what they look for now, and what the current tools do not give them. */
export interface CurrentToolsSection {
  infoSought: string;
  /** "Have you ever felt you didn't have enough information?" */
  missingInfo: string;
  tools: string[];
  /** What they distrust, find frustrating, or find missing. */
  frustrations: string;
}

/** §6 — what a future tool should provide. The core of RQ3. */
export interface NeedsSection {
  wanted: string[];
  trustMost: string;
  sceptical: string;
  /** "Official information, experiences shared by other women, or both? Why?" */
  officialOrLived: "official" | "lived" | "both" | "neither";
  officialOrLivedWhy: string;
  /** Would they contribute, and what would they not share? */
  wouldContribute: boolean;
  contributeLimits: string;
  /** What explanation would make a route recommendation trustworthy. */
  explanationWanted: string;
  /**
   * §6's reframed personalisation question.
   *
   * `factors` is what they'd want taken into account; empty with
   * `prefersNeutral: true` is the other real answer — identical information
   * they do not have to hand over personal data for. The protocol's note is
   * explicit that this must not collapse into "obviously personalised".
   */
  personalFactors: string[];
  prefersNeutral: boolean;
}

/** §7 — hesitations and unintended effects. As important as the features. */
export interface ConcernSection {
  concerns: string[];
  /** "Could a tool like this have a downside?" */
  downside: string;
  /** "Is there anything that would stop you using it, or trusting it?" */
  dealBreaker: string;
}

/** §8 — how the information should be shown. Feeds RQ4. */
export type PresentationForm = "map" | "scores" | "stories" | "comparison" | "other";

export const PRESENTATION_FORMS: PresentationForm[] = [
  "map", "scores", "stories", "comparison", "other",
];

export const PRESENTATION_LABEL: Record<PresentationForm, string> = {
  map: "On a map",
  scores: "Ratings or scores",
  stories: "Written experiences",
  comparison: "A comparison of routes",
  other: "Something else",
};

export interface PresentationSection {
  /** Which of §8's prompts they wanted, in their order of preference. */
  forms: PresentationForm[];
  /** What they would compare options ON. */
  compareOn: string[];
  /** "A simple summary, or the ability to dig deeper?" */
  detail: "summary" | "drill-down" | "both";
  /** Anything they described or sketched that §8's list does not cover. */
  ownIdea: string;
}

export interface Interview {
  id: string;
  /** The participant code used in the transcripts — P01, P02… */
  code: string;
  source: InterviewSource;
  /** ISO 8601 date of the sitting. */
  conductedAt: string;
  /** Minutes. The protocol budgets 30–45. */
  durationMin: number;
  demographics: Demographics;
  mobility: MobilitySection;
  decision: DecisionSection;
  cues: CueSection;
  /** §4 "Have you ever chosen a different or longer route…? How did you weigh that?" */
  tradeOff: string;
  /** §4's printed list, one verdict per place. Keyed by `ProtocolPlace.id`. */
  placeRatings: Record<string, PlaceVerdict>;
  /** Places the participant added beyond the printed list. */
  ownPlaces: string[];
  /** §4 "Which of these would you actually use, and which would not help at all?" */
  wouldUse: string[];
  wouldNotHelp: string[];
  /** §4 "Does the information you need change with the time of day?" */
  timeOfDay: string;
  current: CurrentToolsSection;
  needs: NeedsSection;
  concerns: ConcernSection;
  presentation: PresentationSection;
  /** §9 "Anything else important that we haven't talked about?" */
  closing: string;
  /** Which research questions this sitting gave evidence for. */
  rq: ResearchQuestion[];
  /** The interviewer's own note, where the protocol asks for one. */
  interviewerNote?: string;
}

/* ─────────────────────────────── parsing ────────────────────────────────── */

function str(value: unknown, max = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function strings(value: unknown, max = 40): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const text = str(entry, 200);
    if (text) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function bool(value: unknown): boolean {
  return value === true;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Whatever came out of storage → interviews.
 *
 * Same discipline as `parseReports`: every field is checked and a record that
 * does not survive is DROPPED rather than defaulted. A half-parsed interview
 * shown as a complete one is worse than a missing one, because the gaps are
 * what a requirements analysis reads.
 *
 * ⚠ `source` defaults to `"example"` — the OPPOSITE way round from
 * `parseReports`, and deliberately so. There the failure that matters is an
 * invented point promoted to a real report; here it is an invented QUOTE
 * promoted to real fieldwork, which is the same error pointing the other way.
 * Both defaults fail towards "this might not be real".
 */
export function parseInterviews(raw: unknown): Interview[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  const out: Interview[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;

    const id = str(item.id, 120);
    const code = str(item.code, 24);
    const conductedAt = str(item.conductedAt, 40);
    if (!id || !code) continue;
    if (!conductedAt || Number.isNaN(Date.parse(conductedAt))) continue;

    const demographics = item.demographics as Record<string, unknown> | undefined;
    if (!demographics || typeof demographics !== "object") continue;

    const ratings: Record<string, PlaceVerdict> = {};
    const rawRatings = item.placeRatings;
    if (rawRatings && typeof rawRatings === "object") {
      for (const [place, verdict] of Object.entries(rawRatings as Record<string, unknown>)) {
        // An id the protocol does not list would be a verdict no column can
        // show, and a verdict outside the three is not an answer.
        if (!PLACE_IDS.has(place)) continue;
        if (typeof verdict !== "string" || !VERDICTS.has(verdict)) continue;
        ratings[place] = verdict as PlaceVerdict;
      }
    }

    const mobility = (item.mobility ?? {}) as Record<string, unknown>;
    const decision = (item.decision ?? {}) as Record<string, unknown>;
    const cues = (item.cues ?? {}) as Record<string, unknown>;
    const current = (item.current ?? {}) as Record<string, unknown>;
    const needs = (item.needs ?? {}) as Record<string, unknown>;
    const concerns = (item.concerns ?? {}) as Record<string, unknown>;
    const presentation = (item.presentation ?? {}) as Record<string, unknown>;

    const identityNote = str(demographics.identityNote, 300);
    const interviewerNote = str(item.interviewerNote, 600);
    const duration = typeof item.durationMin === "number" && Number.isFinite(item.durationMin)
      ? Math.max(1, Math.min(240, Math.round(item.durationMin)))
      : 35;

    out.push({
      id,
      code,
      source: item.source === "fieldwork" ? "fieldwork" : "example",
      conductedAt,
      durationMin: duration,
      demographics: {
        ageBand: str(demographics.ageBand, 24),
        city: str(demographics.city, 80),
        yearsInNL: str(demographics.yearsInNL, 60),
        familiarity: str(demographics.familiarity, 80),
        occupation: str(demographics.occupation, 80),
        mainMode: str(demographics.mainMode, 80),
        soloFrequency: str(demographics.soloFrequency, 80),
        // Left off entirely rather than set to "", so a skipped optional
        // question round-trips through JSON as skipped.
        ...(identityNote ? { identityNote } : {}),
      },
      mobility: {
        everyday: str(mobility.everyday),
        appsThatDay: strings(mobility.appsThatDay),
        worked: str(mobility.worked),
        lacked: str(mobility.lacked),
      },
      decision: {
        situation: str(decision.situation),
        whatMadeIt: strings(decision.whatMadeIt),
        optionsWeighed: str(decision.optionsWeighed),
        changedAfter: str(decision.changedAfter),
        general: bool(decision.general),
      },
      cues: {
        safeSpontaneous: strings(cues.safeSpontaneous),
        safePrompted: strings(cues.safePrompted),
        unsafe: strings(cues.unsafe),
        prompted: bool(cues.prompted),
      },
      tradeOff: str(item.tradeOff),
      placeRatings: ratings,
      ownPlaces: strings(item.ownPlaces),
      wouldUse: strings(item.wouldUse),
      wouldNotHelp: strings(item.wouldNotHelp),
      timeOfDay: str(item.timeOfDay),
      current: {
        infoSought: str(current.infoSought),
        missingInfo: str(current.missingInfo),
        tools: strings(current.tools),
        frustrations: str(current.frustrations),
      },
      needs: {
        wanted: strings(needs.wanted),
        trustMost: str(needs.trustMost),
        sceptical: str(needs.sceptical),
        officialOrLived: oneOf(needs.officialOrLived, ["official", "lived", "both", "neither"] as const, "both"),
        officialOrLivedWhy: str(needs.officialOrLivedWhy),
        wouldContribute: bool(needs.wouldContribute),
        contributeLimits: str(needs.contributeLimits),
        explanationWanted: str(needs.explanationWanted),
        personalFactors: strings(needs.personalFactors),
        prefersNeutral: bool(needs.prefersNeutral),
      },
      concerns: {
        concerns: strings(concerns.concerns),
        downside: str(concerns.downside),
        dealBreaker: str(concerns.dealBreaker),
      },
      presentation: {
        forms: (strings(presentation.forms) as PresentationForm[])
          .filter((form) => (PRESENTATION_FORMS as string[]).includes(form)),
        compareOn: strings(presentation.compareOn),
        detail: oneOf(presentation.detail, ["summary", "drill-down", "both"] as const, "both"),
        ownIdea: str(presentation.ownIdea),
      },
      closing: str(item.closing),
      rq: (strings(item.rq) as ResearchQuestion[])
        .filter((question) => ["RQ1", "RQ2", "RQ3", "RQ4"].includes(question)),
      ...(interviewerNote ? { interviewerNote } : {}),
    });
  }
  return out;
}

/* ───────────────────────────── aggregates ───────────────────────────────── */

export function countExampleInterviews(interviews: readonly Interview[]): number {
  return interviews.reduce((total, one) => total + (one.source === "example" ? 1 : 0), 0);
}

export interface PlaceTally {
  place: ProtocolPlace;
  safer: number;
  noDifference: number;
  lessSafe: number;
  /** How many participants answered about this place at all. */
  answered: number;
}

/**
 * §4's printed list, tallied.
 *
 * The whole reason the protocol hands over a PRINTED list is that every
 * participant is asked about the same options, which is what makes a tally
 * meaningful at all. `answered` is carried separately from the three counts so
 * a place nobody was asked about cannot be read as a place nobody chose — the
 * denominator is part of the finding.
 */
export function tallyPlaces(interviews: readonly Interview[]): PlaceTally[] {
  return PROTOCOL_PLACES.map((place) => {
    let safer = 0;
    let noDifference = 0;
    let lessSafe = 0;
    for (const interview of interviews) {
      const verdict = interview.placeRatings[place.id];
      if (verdict === "safer") safer += 1;
      else if (verdict === "no-difference") noDifference += 1;
      else if (verdict === "less-safe") lessSafe += 1;
    }
    return { place, safer, noDifference, lessSafe, answered: safer + noDifference + lessSafe };
  });
}

export interface CueTally {
  cue: string;
  /** How many participants raised it WITHOUT being prompted. */
  spontaneous: number;
  /** How many raised it only after the interviewer offered examples. */
  prompted: number;
  total: number;
}

/**
 * Which cues came up, and whether they had to be fished for.
 *
 * Spontaneous and prompted are counted apart because §4's interviewer note is
 * firm about it: a cue that only ever appears after the interviewer names it is
 * weaker evidence than one a participant volunteered, and an aggregate that
 * merges them cannot tell you which you have.
 */
export function tallyCues(interviews: readonly Interview[], which: "safe" | "unsafe"): CueTally[] {
  const counts = new Map<string, { spontaneous: number; prompted: number }>();
  const bump = (cue: string, key: "spontaneous" | "prompted") => {
    const normalised = cue.trim().toLowerCase();
    if (!normalised) return;
    const row = counts.get(normalised) ?? { spontaneous: 0, prompted: 0 };
    row[key] += 1;
    counts.set(normalised, row);
  };

  for (const interview of interviews) {
    if (which === "safe") {
      for (const cue of interview.cues.safeSpontaneous) bump(cue, "spontaneous");
      for (const cue of interview.cues.safePrompted) bump(cue, "prompted");
    } else {
      // The unsafe probe is symmetric and is always asked directly, so every
      // answer to it counts as volunteered.
      for (const cue of interview.cues.unsafe) bump(cue, "spontaneous");
    }
  }

  return [...counts.entries()]
    .map(([cue, row]) => ({ cue, ...row, total: row.spontaneous + row.prompted }))
    .sort((a, b) => b.total - a.total || b.spontaneous - a.spontaneous || a.cue.localeCompare(b.cue));
}

/** How the room split on official figures versus lived experience (§6). */
export function tallySources(interviews: readonly Interview[]): Record<string, number> {
  const out: Record<string, number> = { official: 0, lived: 0, both: 0, neither: 0 };
  for (const interview of interviews) {
    const key = interview.needs.officialOrLived;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** How the room split on §8's presentation forms, most-wanted first. */
export function tallyPresentation(interviews: readonly Interview[]): { form: PresentationForm; count: number }[] {
  return PRESENTATION_FORMS
    .map((form) => ({
      form,
      count: interviews.reduce((total, one) => total + (one.presentation.forms.includes(form) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * How many would contribute their own experiences, and how many would not (§6).
 *
 * Load-bearing for this app specifically: the purple layer starts empty and
 * only fills if people are willing to write in it, so the split here is a
 * prediction about whether that layer can work at all.
 */
export function tallyContribution(interviews: readonly Interview[]): { yes: number; no: number } {
  let yes = 0;
  for (const interview of interviews) if (interview.needs.wouldContribute) yes += 1;
  return { yes, no: interviews.length - yes };
}
