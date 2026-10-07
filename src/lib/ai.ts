/**
 * The model that puts the read into words. SERVER ONLY.
 *
 * ONE model, hardcoded: the Liara gateway, OpenAI-compatible, at the base URL
 * and key below. There is no local tier any more and no environment variable
 * to set — the LAN box it used to fall back to is not part of this deployment,
 * and a "tier that is present when a variable is set" is a configuration that
 * differs between the two servers this app answers from, which is exactly the
 * class of bug the rest of this repo spends its time avoiding.
 *
 * ⚠ THE KEY IS IN THE SOURCE ON PURPOSE, and that is a real cost worth naming:
 * anyone who can read this repository can spend it. It is here because it was
 * asked for explicitly — one file, no env, nothing to keep in step between two
 * boxes. If the repository is ever made public, or the key leaks, the fix is to
 * rotate it in Liara's dashboard and change the constant below; there is
 * nowhere else it lives.
 *
 * The key never reaches the browser. This module is imported only by
 * `/api/assess`, which is why that route exists at all — see its header.
 *
 * `openai/text-embedding-3-large` is what Liara's own sample snippet calls, and
 * it is NOT what this app needs: an embedding model returns vectors, not
 * sentences, and would refuse `/chat/completions` on every request. The model
 * below is a chat model for that reason.
 *
 * The model NEVER produces the score. It is handed numbers that were already
 * computed and asked to explain them; if it is unavailable the page still shows
 * the score and the findings, just without the prose.
 */

import type { Light } from "./daylight.ts";
import type { Assessment } from "./score.ts";
import type { RouteFacts } from "./overpass.ts";

/** The gateway. OpenAI-compatible, so `/chat/completions` hangs off it. */
export const AI_BASE_URL = "https://ai.liara.ir/api/69a0a2c007ee11c812ee5444/v1";

/** The key. See the warning in the header before moving it anywhere. */
export const AI_API_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJrZXkiOiI2YWE1OTA2ZGNmNzAxNmMzZDNiOTViOWIiLCJ0eXBlIjoiYWlfa2V5IiwiaWF0IjoxNzg5MjM1MzA5fQ." +
  "7MvU1-xpSBWxwXIbhZln_mieD2UA6S0BdHt0ArmMS84";

/**
 * A CHAT model, not an embedding model.
 *
 * The whole job is three sentences explaining numbers that are already on the
 * screen, so the small one is the right one: it is faster, and the page is
 * waiting on it before it can show the prose.
 */
export const AI_MODEL = "openai/gpt-4o-mini";

/** How long to wait for the sentence before giving up on it. */
export const AI_TIMEOUT_MS = 20_000;

const SYSTEM = `You explain a walking-route safety reading to the person about to walk it.

You are given numbers already computed from OpenStreetMap. Treat them as the only
facts you have.

Rules:
- Never invent a number, a street name, or anything not in the input.
- Never state a score. It is shown separately.
- If the data is thin, say the map is thin. "Unknown" is never "fine".
- Never call a route or a street safe, unsafe or dangerous. Say what the map
  records — lit streets, lamps, open shops, parkland — and let the reader decide.
- Two or three sentences. Plain, calm, second person. No preamble, no bullet
  points, no markdown.`;

/**
 * How the light is described to the model.
 *
 * Dusk is spelled out rather than left as a word: "twilight" alone invites a
 * sentence about how pretty it is, and what the reader needs is that the sun is
 * down and the lighting has started to matter.
 */
const LIGHT_WORD: Record<Light, string> = {
  day: "daylight",
  twilight: "dusk — the sun is below the horizon, but not far below it",
  night: "after dark",
};

export function prompt(facts: RouteFacts, assessment: Assessment): string {
  return [
    `Route: ${(facts.lengthM / 1000).toFixed(1)} km, ${facts.samples} points sampled.`,
    `Time of day: ${LIGHT_WORD[assessment.light]}.`,
    `Lighting: ${facts.litSamples} points on streets mapped lit, ${facts.unlitSamples} mapped unlit,`,
    `  ${facts.unknownLitSamples} with no lighting information at all.`,
    `Street lamps mapped nearby: ${facts.lamps}.`,
    `Shops, cafes or bars along it: ${facts.venues}.`,
    `Points inside parkland: ${facts.greenSamples}. Crossings: ${facts.crossings}. Tunnels: ${facts.tunnels}.`,
    `Verdict computed: ${assessment.verdict}. Confidence: ${assessment.confidence}.`,
    "",
    "Explain what this means for the walk.",
  ].join("\n");
}

interface ChatReply {
  choices?: { message?: { content?: string } }[];
}

async function ask(body: string, timeoutMs: number): Promise<string | null> {
  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: body },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new Error(`the model answered ${response.status}`);
  const reply = (await response.json()) as ChatReply;
  const text = reply.choices?.[0]?.message?.content?.trim();
  return text && text.length > 0 ? text : null;
}

export interface Narration {
  text: string | null;
  /** `"liara"` when the model answered, null when it could not. */
  source: "liara" | null;
  /** Why there is no text. Shown to nobody, logged for the operator. */
  note?: string;
}

/**
 * Ask the model. Never throws.
 *
 * A failure here costs the sentence, not the assessment: the caller already has
 * a score and a list of findings, and shows them regardless. There is no second
 * tier to fall back to, which makes that degradation the whole error path
 * rather than an unlikely one — it has to stay quiet and complete.
 */
export async function narrate(
  facts: RouteFacts,
  assessment: Assessment,
  options: { timeoutMs?: number } = {},
): Promise<Narration> {
  try {
    const text = await ask(prompt(facts, assessment), options.timeoutMs ?? AI_TIMEOUT_MS);
    if (text) return { text, source: "liara" };
    return { text: null, source: null, note: "the model returned an empty reply" };
  } catch (error) {
    return { text: null, source: null, note: error instanceof Error ? error.message : "the model failed" };
  }
}
