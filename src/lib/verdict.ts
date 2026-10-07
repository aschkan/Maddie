/**
 * How a verdict is written and coloured, in one place.
 *
 * The label was copied into `SafetyPanel` and `RouteChoices` separately, and
 * the segment strip and the coloured route line need it too. Four copies of
 * "Not enough map data" is four chances for one of them to start saying
 * something more comfortable than the others.
 *
 * ⚠ The words. None of these says "safe", "unsafe" or "danger", and
 * `test/palette.test.ts` fails if one ever does. The supervisor's objection
 * was that calling a street safe is "a lot of responsibility" this data cannot
 * carry: what it supports is "the indicators the map records are favourable
 * here", or "they are not — look closer". The label names the EVIDENCE, and
 * the reader draws the conclusion.
 *
 * The colours live in `palette.ts`, with every other colour on the map, so that
 * "one colour, one meaning" can be checked in one place.
 */

import { pick, ROUTE, type Tone } from "./palette.ts";
import type { Verdict } from "./score.ts";

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: "Favourable",
  fair: "Mixed",
  poor: "Look closer",
  unknown: "Not enough map data",
};

/**
 * One sentence per verdict, for the legend's info button and the Safety tab.
 * What the colour means, and what it does NOT mean.
 */
export const VERDICT_EXPLAIN: Record<Verdict, string> = {
  good:
    "Most of what the map records here counts in its favour: lit, with open frontage, " +
    "few parks or underpasses after dark. A reading of the map, not a promise.",
  fair: "Some indicators count for it and some against. Worth a look at the details.",
  poor:
    "Several indicators count against this stretch at the hour you chose — unlit, " +
    "parkland, few open doors, or an underpass. Look closer before choosing it.",
  unknown:
    "OpenStreetMap records too little here to say anything. A gap in the map — not a " +
    "dark street, and not a reassurance either.",
};

/**
 * The class that carries a verdict's colour into the CSS.
 *
 * A class rather than a hex wherever the browser is doing the painting, because
 * the two themes need different values for the same verdict. `--verdict` is set
 * by these classes and read by `.verdict`, `.peek-verdict` and anything else
 * showing one.
 */
export const VERDICT_CLASS: Record<Verdict, string> = {
  good: "v-good",
  fair: "v-fair",
  poor: "v-poor",
  unknown: "v-unknown",
};

/** The canvas colour for a verdict on a map of this tone. */
export function verdictColour(verdict: Verdict, tone: Tone): string {
  return pick(ROUTE[verdict], tone);
}

/** Scores from here up are `good`, from `FAIR_FROM` up are `fair`. See `score.ts`. */
export const GOOD_FROM = 70;
export const FAIR_FROM = 45;
