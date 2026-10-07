/**
 * The one server-side endpoint.
 *
 * It exists for exactly one reason: the model cannot be called from the
 * browser. The LAN box is unreachable from a phone on mobile data, and the
 * Liara key would be handed to every visitor. Everything else — tiles, routing,
 * search, and the OpenStreetMap query behind the facts — the browser does
 * itself.
 *
 * The browser sends FACTS, not a route to look up: the counting already
 * happened client-side, so this endpoint has no network dependency beyond the
 * model itself.
 */

import { narrate } from "@/lib/ai";
import { ALL_FACTORS, assess, FACTORS, type Factors, type Timing } from "@/lib/score";
import type { LatLng } from "@/lib/osrm";
import type { RouteFacts } from "@/lib/overpass";

export const dynamic = "force-dynamic";

/** Numbers only, all finite, all non-negative. Anything else is refused. */
function readFacts(value: unknown): RouteFacts | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const keys = [
    "lengthM", "samples", "litSamples", "unlitSamples", "unknownLitSamples",
    "footwaySamples", "greenSamples", "lamps", "venues", "crossings", "tunnels",
  ] as const;

  const out: Record<string, number> = {};
  for (const key of keys) {
    const n = raw[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    // A bound, so a hostile caller cannot push absurd numbers into the prompt.
    out[key] = Math.min(n, 1_000_000);
  }
  if (out.samples === 0) return null;
  return out as unknown as RouteFacts;
}

/**
 * Somewhere on the route, so the sun's elevation can be worked out.
 *
 * Optional, and its absence is not an error: an older page, or any other
 * caller, may send only an hour, and `assess` falls back to the clock rule and
 * marks the answer as having done so. What is refused is a point that is not
 * one — 0,0 from a `Number("")` is a real place in the Gulf of Guinea, and the
 * sun there says nothing about a walk in Amsterdam.
 */
function readPoint(value: unknown): LatLng | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { lat?: unknown; lng?: unknown };
  if (typeof raw.lat !== "number" || typeof raw.lng !== "number") return null;
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null;
  if (Math.abs(raw.lat) > 90 || Math.abs(raw.lng) > 180) return null;
  return { lat: raw.lat, lng: raw.lng };
}

/**
 * The instant being planned for, as the browser worked it out.
 *
 * Sent rather than rebuilt here, because "today at 22:00" has to mean the
 * viewer's 22:00. This server's timezone is whatever the box was installed
 * with, and rebuilding the instant from the hour would quietly answer for a
 * different evening.
 */
/**
 * The Layers tab's switches. Anything unreadable means "all on" — the default
 * every route is scored with — never "all off", which would turn a malformed
 * request into a verdict of "nothing to compare on".
 */
function readFactors(value: unknown): Factors {
  if (!value || typeof value !== "object") return ALL_FACTORS;
  const raw = value as Record<string, unknown>;
  const out = { ...ALL_FACTORS };
  for (const factor of FACTORS) {
    if (raw[factor.id] === false) out[factor.id] = false;
  }
  return out;
}

function readInstant(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : undefined;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const payload = body as { facts?: unknown; hour?: unknown; point?: unknown; at?: unknown; factors?: unknown };
  const facts = readFacts(payload.facts);
  if (!facts) {
    return Response.json({ error: "Those route facts are not usable." }, { status: 400 });
  }

  const hour =
    typeof payload.hour === "number" && Number.isFinite(payload.hour)
      ? Math.max(0, Math.min(23, Math.floor(payload.hour)))
      : new Date().getHours();

  // With a point the sun is worked out properly; without one, the hour alone
  // stands in and the assessment says `sunDeg: null` rather than pretending.
  const point = readPoint(payload.point);
  const timing: Timing = point ? { hour, point, at: readInstant(payload.at) } : hour;

  // The same switches the page scored with, so the sentence explains the
  // number on the screen rather than a different one.
  const assessment = assess(facts, timing, readFactors(payload.factors));

  /*
   * No score, no narration.
   *
   * When there is nothing to judge there is nothing to explain, and a model
   * asked to comment anyway can only produce a sentence that sounds like an
   * answer. Observed exactly that: a fluent "most of this walk is on lit
   * streets" printed directly under "Not enough map data". The findings already
   * say the true thing, plainly, and they cannot drift.
   */
  const narration =
    assessment.score === null
      ? { text: null, source: null, note: "verdict is unknown — nothing to narrate" as const }
      : await narrate(facts, assessment);

  if (!narration.text && narration.note && assessment.score !== null) {
    // Worth the operator seeing: it says which tier failed and why. The page
    // shows the assessment either way.
    console.warn(`[assess] no narration — ${narration.note}`);
  }

  return Response.json({
    ...assessment,
    narration: narration.text,
    narratedBy: narration.source,
  });
}
