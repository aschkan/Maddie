/**
 * How a verdict is written and coloured, in one place.
 *
 * The label was copied into `SafetyPanel` and `RouteChoices` separately, and
 * the segment strip and the coloured route line need it too. Four copies of
 * "Not enough map data" is four chances for one of them to start saying
 * something more comfortable than the others.
 *
 * The colours are hex rather than CSS classes because Leaflet draws the route
 * onto a canvas and takes a colour string — a class never reaches it. They are
 * picked to hold up against both the light and the inverted night basemap.
 */

import type { Verdict } from "./score.ts";

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: "Looks fine",
  fair: "Mixed",
  poor: "Take care",
  unknown: "Not enough map data",
};

/**
 * Grey for `unknown`, and that is the important one.
 *
 * An unjudged stretch must not be drawn in the same red as a badly lit one:
 * "nobody has mapped this" and "this is dark" are different statements, and
 * colouring them alike turns a gap in the map into an accusation about a
 * street. Grey reads as absent, which is what it is.
 */
/**
 * The class that carries a verdict's colour into the CSS.
 *
 * A class rather than a hex wherever the browser is doing the painting, because
 * the two themes need different values for the same verdict: the light-on-dark
 * green that reads at night is invisible on white. `--verdict` is set by these
 * classes and read by `.verdict`, `.peek-verdict` and anything else showing one.
 */
export const VERDICT_CLASS: Record<Verdict, string> = {
  good: "v-good",
  fair: "v-fair",
  poor: "v-poor",
  unknown: "v-unknown",
};

export const VERDICT_COLOUR: Record<Verdict, string> = {
  good: "#35c46a",
  fair: "#e8b33a",
  poor: "#f2603c",
  unknown: "#8892a6",
};
