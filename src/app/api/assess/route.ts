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
import { assess } from "@/lib/score";
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

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const payload = body as { facts?: unknown; hour?: unknown };
  const facts = readFacts(payload.facts);
  if (!facts) {
    return Response.json({ error: "Those route facts are not usable." }, { status: 400 });
  }

  const hour =
    typeof payload.hour === "number" && Number.isFinite(payload.hour)
      ? Math.max(0, Math.min(23, Math.floor(payload.hour)))
      : new Date().getHours();

  const assessment = assess(facts, hour);

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
