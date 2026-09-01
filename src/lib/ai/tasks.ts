/**
 * The seven model tasks. Each one has a Zod schema, and a reply that does not
 * validate is a gap — never a default that reads like a finding.
 */
import { z } from "zod";
import { runTask, type AiOutcome } from "./client.ts";
import { absent, present, type Signal } from "../signal.ts";
import type { ReviewReading, VisionReading } from "../scoring/dimensions.ts";
import type { StreetImage } from "../sources/mapillary.ts";
import type { VenueReview } from "../sources/google-places.ts";
import type { LatLng } from "../geo/wkt.ts";

const score = z.number().min(0).max(100).nullable();

const VisionSchema = z.object({
  lighting: score,
  sightlines: score,
  summary: z.string().max(400),
});

const ReviewSchema = z.object({
  staffProtective: score,
  harassmentMentions: z.number().int().min(0).max(50).nullable(),
  summary: z.string().max(500),
});

const ModerationSchema = z.object({
  publish: z.boolean(),
  reason: z.string().max(300),
  containsIdentifyingDetail: z.boolean(),
});

const InterviewSchema = z.object({
  themes: z.array(z.string().max(60)).max(10),
  summary: z.string().max(1_200),
});

const SegmentSchema = z.object({
  concerns: z.array(z.string().max(120)).max(6),
  summary: z.string().max(400),
});

const RouteChoiceSchema = z.object({
  preferredIndex: z.number().int().min(0).max(9),
  why: z.string().max(400),
});

const LocationSchema = z.object({
  query: z.string().max(160),
  kind: z.enum(["address", "venue-type", "area", "unknown"]),
});

const VISION_SYSTEM = `You assess street-level photographs for how safe a street feels to a woman walking alone at night.
Judge only what is visible. Report lighting (0 = pitch dark, 100 = evenly and brightly lit) and sightlines
(0 = blind corners, walls, deep recesses; 100 = long open views with nowhere to be surprised from).
If a photograph is taken in daylight, judge how well lit it would be at night from the visible lamp posts and
lit shopfronts, and say in the summary that you are inferring. If you cannot tell, return null for that field
rather than guessing. Reply with JSON only: {"lighting":number|null,"sightlines":number|null,"summary":string}`;

export async function readStreetImagery(
  images: readonly StreetImage[],
  point: LatLng,
): Promise<Signal<VisionReading>> {
  const source = "Vision model";
  if (images.length === 0) {
    return absent("no-coverage", source, "No street imagery was available, so lighting was not looked at. That is a gap in the data, not a statement about the place.");
  }
  const outcome = await runTask(
    {
      task: "street-view-vision",
      system: VISION_SYSTEM,
      user: `These are ${images.length} street-level photographs taken near ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}. Assess them together.`,
      images: images.map((image) => ({ url: image.url })),
      maxTokens: 400,
    },
    VisionSchema,
    `${point.lat.toFixed(4)},${point.lng.toFixed(4)}:${images.length}`,
    6 * 60 * 60 * 1000,
  );
  if (!outcome.ok || outcome.value === null) return absent("unreachable", source, outcome.note);
  return present(outcome.value, `${source} (${outcome.tier})`, 0.45);
}

const REVIEW_SYSTEM = `You read venue reviews for one thing only: how this place treats women who are on their own.
Look for staff intervening when someone is bothered, door policy, being followed or harassed inside or just outside,
drink safety, and how women describe the atmosphere. Ignore food, price, decor and service speed entirely.
staffProtective: 0 = reviews describe staff ignoring or worsening harassment, 100 = reviews describe staff actively
stepping in. Return null if no review speaks to it at all — do not substitute the star rating.
harassmentMentions: how many reviews describe harassment happening here.
Reply with JSON only: {"staffProtective":number|null,"harassmentMentions":number|null,"summary":string}`;

export async function readReviews(reviews: readonly VenueReview[], placeId: string): Promise<Signal<ReviewReading>> {
  const source = "Review analysis";
  if (reviews.length === 0) {
    return absent("no-coverage", source, "No reviews were available for this venue, so nothing is known about how it treats women on their own. That is a gap in the data, not a statement about the place.");
  }
  const body = reviews
    .slice(0, 20)
    .map((review, index) => `[${index + 1}${review.rating === null ? "" : ` · ${review.rating}★`}] ${review.text}`)
    .join("\n\n");
  const outcome = await runTask(
    { task: "analyse-reviews", system: REVIEW_SYSTEM, user: body, maxTokens: 500 },
    ReviewSchema,
    placeId,
    12 * 60 * 60 * 1000,
  );
  if (!outcome.ok || outcome.value === null) return absent("unreachable", source, outcome.note);
  return present(outcome.value, `${source} (${outcome.tier})`, 0.5);
}

const MODERATION_SYSTEM = `You moderate anonymous safety reports written by women about specific places.
Publish by default: this is testimony, and refusing it silences the person who wrote it. Withhold ONLY when the
text names or clearly identifies a private individual, is obviously spam or advertising, or is an attack on a
named person rather than an account of an experience. Distress, anger and swearing are not reasons to withhold.
Reply with JSON only: {"publish":boolean,"reason":string,"containsIdentifyingDetail":boolean}`;

export interface ModerationVerdict {
  publish: boolean;
  reason: string;
  containsIdentifyingDetail: boolean;
  /** False when no model answered — the report is published anyway. */
  reviewed: boolean;
}

export async function moderateReport(text: string): Promise<ModerationVerdict> {
  if (text.trim() === "") {
    return { publish: true, reason: "No free text to review.", containsIdentifyingDetail: false, reviewed: false };
  }
  const outcome = await runTask(
    { task: "moderate-report", system: MODERATION_SYSTEM, user: text, maxTokens: 300 },
    ModerationSchema,
  );
  if (!outcome.ok || outcome.value === null) {
    // The model being down must not become a silent censor. A report that
    // could not be reviewed is published and marked unreviewed.
    return { publish: true, reason: "No moderation model was available; published unreviewed.", containsIdentifyingDetail: false, reviewed: false };
  }
  return { ...outcome.value, reviewed: true };
}

const INTERVIEW_SYSTEM = `You analyse a research interview with a woman about feeling safe or unsafe in public space.
Pull out the recurring themes as short noun phrases, and write a summary that keeps her own framing and does not
sanitise it. Never invent detail that is not in the transcript.
Reply with JSON only: {"themes":string[],"summary":string}`;

export async function analyseInterview(transcript: string): Promise<{ themes: string[]; summary: string; analysed: boolean }> {
  const outcome = await runTask(
    { task: "analyse-interview", system: INTERVIEW_SYSTEM, user: transcript.slice(0, 24_000), maxTokens: 900 },
    InterviewSchema,
  );
  if (!outcome.ok || outcome.value === null) return { themes: [], summary: "", analysed: false };
  return { ...outcome.value, analysed: true };
}

const SEGMENT_SYSTEM = `You are given measured facts about one 250-metre stretch of a walking route, at a specific hour.
Name the concrete concerns a woman walking it alone would have, in plain words, and nothing else. Do not reassure,
do not moralise, do not suggest she not go. If the facts are thin, say what is not known rather than filling it in.
Reply with JSON only: {"concerns":string[],"summary":string}`;

export async function readSegment(facts: string, cacheKey: string): Promise<AiOutcome<z.infer<typeof SegmentSchema>>> {
  return runTask(
    { task: "infer-segment", system: SEGMENT_SYSTEM, user: facts, maxTokens: 350 },
    SegmentSchema,
    cacheKey,
    60 * 60 * 1000,
  );
}

const COMPARE_SYSTEM = `You are comparing walking routes for a woman travelling alone at a specific hour.
You are given each route's measured safety scores and what is missing from them. Choose the one you would
recommend and say why in two sentences. A route with a higher score but far weaker evidence is not automatically
better — say so if that is the case.
Reply with JSON only: {"preferredIndex":number,"why":string}`;

export async function compareRoutes(facts: string): Promise<AiOutcome<z.infer<typeof RouteChoiceSchema>>> {
  return runTask({ task: "compare-routes", system: COMPARE_SYSTEM, user: facts, maxTokens: 300 }, RouteChoiceSchema);
}

const LOCATION_SYSTEM = `You turn a person's plain-language search into something a Dutch geocoder can answer.
"somewhere to get paracetamol at 2am" is a venue-type search for a pharmacy; "near centraal" is an area.
Reply with JSON only: {"query":string,"kind":"address"|"venue-type"|"area"|"unknown"}`;

export async function inferLocation(text: string): Promise<AiOutcome<z.infer<typeof LocationSchema>>> {
  return runTask(
    { task: "infer-location", system: LOCATION_SYSTEM, user: text, maxTokens: 150 },
    LocationSchema,
    text.toLowerCase().slice(0, 80),
    24 * 60 * 60 * 1000,
  );
}
