/**
 * The model that puts the read into words. SERVER ONLY.
 *
 * Two tiers, in this order:
 *
 *   LOCAL   an OpenAI-compatible server on the LAN (LM Studio, Ollama,
 *           llama.cpp, vLLM). Free per call, private — and this app is being
 *           told where someone is walking and at what hour — and it cannot be
 *           rate-limited or cut off for a billing failure.
 *   LIARA   a hosted fallback, for when the LAN box is off.
 *
 * Why this cannot run in the browser: the LAN address is unreachable from a
 * phone on mobile data, and the Liara key would be shipped to every visitor.
 * That is the entire reason this app has one API route.
 *
 * The model NEVER produces the score. It is handed numbers that were already
 * computed and asked to explain them; if it is unavailable the page still shows
 * the score and the findings, just without the prose.
 */

import type { Light } from "./daylight.ts";
import type { Assessment } from "./score.ts";
import type { RouteFacts } from "./overpass.ts";

export interface Tier {
  name: "local" | "liara";
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/**
 * The tiers that are actually configured, best first.
 *
 * LM Studio needs no key, so the local tier is present whenever a host is set.
 * Liara is only included once both a base URL and a key exist — a half-set
 * fallback that 401s on every call is worse than no fallback, because it turns
 * "the LAN box is off" into a confusing error rather than a quiet degradation.
 */
/** Just the names it reads — narrower than ProcessEnv, and trivially fakeable. */
export type Env = Record<string, string | undefined>;

export function tiers(env: Env = process.env): Tier[] {
  const out: Tier[] = [];

  const localHost = env.LOCAL_AI_HOST?.trim();
  const localUrl = env.LOCAL_AI_URL?.trim() || (localHost ? `http://${localHost}:1234/v1` : "");
  if (localUrl && localUrl !== "off") {
    out.push({
      name: "local",
      baseUrl: localUrl.replace(/\/+$/, ""),
      model: env.LOCAL_AI_MODEL?.trim() || "gemma-3-4b-it",
    });
  }

  const liaraUrl = env.LIARA_AI_URL?.trim();
  const liaraKey = env.LIARA_AI_KEY?.trim();
  if (liaraUrl && liaraKey) {
    out.push({
      name: "liara",
      baseUrl: liaraUrl.replace(/\/+$/, ""),
      model: env.LIARA_AI_MODEL?.trim() || "openai/gpt-4o-mini",
      apiKey: liaraKey,
    });
  }

  return out;
}

const SYSTEM = `You explain a walking-route safety reading to the person about to walk it.

You are given numbers already computed from OpenStreetMap. Treat them as the only
facts you have.

Rules:
- Never invent a number, a street name, or anything not in the input.
- Never state a score. It is shown separately.
- If the data is thin, say the map is thin. "Unknown" is never "fine".
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

function prompt(facts: RouteFacts, assessment: Assessment): string {
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

async function ask(tier: Tier, body: string, timeoutMs: number): Promise<string | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // LM Studio ignores it; some gateways refuse without one.
  if (tier.apiKey) headers.Authorization = `Bearer ${tier.apiKey}`;

  const response = await fetch(`${tier.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: tier.model,
      temperature: 0.2,
      max_tokens: 220,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: body },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) throw new Error(`${tier.name} answered ${response.status}`);
  const reply = (await response.json()) as ChatReply;
  const text = reply.choices?.[0]?.message?.content?.trim();
  return text && text.length > 0 ? text : null;
}

export interface Narration {
  text: string | null;
  /** Which tier answered, or null when none could. */
  source: Tier["name"] | null;
  /** Why there is no text. Shown to nobody, logged for the operator. */
  note?: string;
}

/**
 * Ask each configured tier in turn. Never throws.
 *
 * A failure here costs the sentence, not the assessment: the caller already has
 * a score and a list of findings, and shows them regardless.
 */
export async function narrate(
  facts: RouteFacts,
  assessment: Assessment,
  options: { env?: Env; timeoutMs?: number } = {},
): Promise<Narration> {
  const list = tiers(options.env);
  if (list.length === 0) return { text: null, source: null, note: "no AI tier configured" };

  const body = prompt(facts, assessment);
  const problems: string[] = [];

  for (const tier of list) {
    try {
      const text = await ask(tier, body, options.timeoutMs ?? 20_000);
      if (text) return { text, source: tier.name };
      problems.push(`${tier.name}: empty reply`);
    } catch (error) {
      problems.push(`${tier.name}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }

  return { text: null, source: null, note: problems.join("; ") };
}
