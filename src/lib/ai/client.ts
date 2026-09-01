/**
 * The AI tier: an OpenAI-compatible server on the LAN first, a hosted one
 * second.
 *
 * Local-first is architecture, not preference:
 *  - free per call, which is what makes it affordable to score forty route
 *    segments rather than four;
 *  - private, and this app reasons about where a woman is, at what hour, alone
 *    or not — plus interview transcripts given in confidence;
 *  - it cannot be blocked, rate-limited, or cut off for a billing failure.
 *
 * The AI tier has its OWN proxy switch, defaulted OFF: the local model is on
 * the LAN (never proxied by rule) and the cloud fallback is reachable from
 * this network directly, so neither wants a detour.
 */
import { z } from "zod";
import { getConfig } from "../config.ts";
import { gate } from "../http/limiter.ts";
import { upstreamFetch, upstreamBytes } from "../http/fetch.ts";
import { logger } from "../log.ts";
import { cacheDelete, cached } from "../cache.ts";
import { getAiSettings } from "../store/repositories.ts";

const log = logger("ai");

export type AiTask =
  | "infer-location"
  | "infer-segment"
  | "street-view-vision"
  | "analyse-reviews"
  | "moderate-report"
  | "compare-routes"
  | "analyse-interview";

export interface AiTier {
  name: "local" | "cloud";
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
  provider: string;
}

/** Operator overrides from the admin route win over the environment. */
export async function tiers(): Promise<AiTier[]> {
  const config = getConfig();
  const overrides = (await getAiSettings()) ?? {};

  const localUrl = overrides.localUrl ?? config.localAiUrl;
  const cloudBase = overrides.cloudBase ?? config.cloudAiBase;

  const local: AiTier = {
    name: "local",
    baseUrl: localUrl,
    // LM Studio does not require a key on the LAN; some clients insist on a
    // value, and it is ignored.
    apiKey: "lm-studio",
    model: overrides.localModel ?? config.localAiModel,
    visionModel: overrides.localVisionModel ?? config.localAiVisionModel ?? "",
    provider: "",
  };
  const cloud: AiTier = {
    name: "cloud",
    baseUrl: cloudBase,
    apiKey: config.cloudAiKey,
    model: overrides.cloudModel ?? config.cloudAiModel,
    visionModel: overrides.cloudVisionModel ?? config.cloudAiVisionModel ?? "",
    provider: config.cloudAiProvider,
  };

  const available = [local, cloud].filter((tier) => tier.baseUrl !== "" && tier.model !== "");
  const localFirst = overrides.localFirst ?? config.aiLocalFirst;
  return localFirst ? available : available.reverse();
}

function modelFor(tier: AiTier, task: AiTask, vision: boolean): string {
  const config = getConfig();
  const override = config.aiTaskModels[`${tier.name}:${task}`] ?? config.aiTaskModels[task];
  if (override !== undefined) return override;
  if (vision) return tier.visionModel !== "" ? tier.visionModel : tier.model;
  return tier.model;
}

export interface ImageInput {
  /** Absolute URL. Fetched server-side and inlined; the model box may have no
   *  route to the imagery host, and it certainly should not need one. */
  url: string;
}

export interface AiRequest {
  task: AiTask;
  system: string;
  user: string;
  images?: ImageInput[];
  maxTokens?: number;
  temperature?: number;
}

interface ChatMessageContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

const ChatResponse = z
  .object({
    choices: z
      .array(z.object({ message: z.object({ content: z.string().nullable().optional() }).loose() }).loose())
      .default([]),
  })
  .loose();

async function inlineImage(image: ImageInput): Promise<string | null> {
  try {
    const response = await upstreamBytes(image.url, { timeoutMs: 15_000 });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const base64 = Buffer.from(response.bytes).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    return null;
  }
}

function aiGate() {
  return gate("ai", { maxConcurrent: getConfig().aiMaxConcurrent, minIntervalMs: 0 });
}

async function callTier(tier: AiTier, request: AiRequest, inlined: string[]): Promise<string | null> {
  const config = getConfig();
  const vision = inlined.length > 0;
  const content: ChatMessageContent[] = [{ type: "text", text: request.user }];
  for (const dataUrl of inlined) content.push({ type: "image_url", image_url: { url: dataUrl } });

  const body: Record<string, unknown> = {
    model: modelFor(tier, request.task, vision),
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: vision ? content : request.user },
    ],
    temperature: request.temperature ?? 0.1,
    max_tokens: request.maxTokens ?? 700,
    stream: false,
  };
  if (tier.provider !== "") body.provider = { order: [tier.provider] };

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tier.apiKey !== "") headers.authorization = `Bearer ${tier.apiKey}`;

  const response = await upstreamFetch(`${tier.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeoutMs: config.aiTimeoutMs,
    // OFF by default: the LAN model is never proxied by rule, and the cloud
    // one is reachable directly.
    direct: !config.aiUseProxy,
  });
  if (!response.ok) {
    log.warn(`${tier.name} tier answered ${response.status}`);
    return null;
  }
  const parsed = ChatResponse.safeParse(JSON.parse(response.text));
  if (!parsed.success) return null;
  return parsed.data.choices[0]?.message.content ?? null;
}

/** Models wrap JSON in prose and fences however much you ask them not to. */
export function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface AiOutcome<T> {
  ok: boolean;
  value: T | null;
  tier: string | null;
  note: string;
}

/**
 * Runs a task and validates the reply against a schema, with exactly one
 * repair lap. The final result is cached; a failed lap never is, and the whole
 * entry is dropped when the chain fails — otherwise a ten-second outage is
 * cached for a day.
 */
export async function runTask<T>(
  request: AiRequest,
  schema: z.ZodType<T>,
  cacheKey?: string,
  ttlMs = 30 * 60 * 1000,
): Promise<AiOutcome<T>> {
  const config = getConfig();
  if (!config.aiEnabled) {
    return { ok: false, value: null, tier: null, note: "The model tier is switched off on this deployment." };
  }

  const key = cacheKey === undefined ? null : `ai:${request.task}:${cacheKey}`;
  const produce = async (): Promise<AiOutcome<T>> => {
    const available = await tiers();
    if (available.length === 0) {
      return {
        ok: false,
        value: null,
        tier: null,
        note: "No model endpoint is configured, so this reading was not taken. That is a gap in the data, not a statement about the place.",
      };
    }

    const inlined: string[] = [];
    for (const image of request.images ?? []) {
      const dataUrl = await inlineImage(image);
      if (dataUrl !== null) inlined.push(dataUrl);
    }
    if ((request.images?.length ?? 0) > 0 && inlined.length === 0) {
      return { ok: false, value: null, tier: null, note: "The imagery could not be fetched, so nothing was looked at." };
    }

    return aiGate().run(async () => {
      for (const tier of available) {
        for (let lap = 0; lap < 2; lap += 1) {
          const ask: AiRequest =
            lap === 0
              ? request
              : {
                  ...request,
                  user: `${request.user}\n\nYour previous reply did not parse. Reply with JSON only — no prose, no code fence, no explanation.`,
                };
          let raw: string | null = null;
          try {
            raw = await callTier(tier, ask, inlined);
          } catch (error) {
            log.warn(`${tier.name} tier failed`, error instanceof Error ? error.message : error);
            break; // a transport failure is the tier's problem, not the prompt's
          }
          if (raw === null) continue;
          const parsed = schema.safeParse(extractJson(raw));
          if (parsed.success) {
            return { ok: true, value: parsed.data, tier: tier.name, note: "" };
          }
          log.debug(`${tier.name} reply failed validation on lap ${lap + 1}`);
        }
      }
      return {
        ok: false,
        value: null,
        tier: null,
        note: "No model produced a usable answer, so this reading was not taken. That is a gap in the data, not a statement about the place.",
      };
    });
  };

  if (key === null) return produce();

  const outcome = await cached(key, ttlMs, produce);
  // Never leave a failure sitting in the cache for the length of the TTL.
  if (!outcome.ok) cacheDelete(key);
  return outcome;
}

export interface AiHealth {
  tier: string;
  baseUrl: string;
  model: string;
  reachable: boolean;
  note: string;
}

export async function aiHealth(): Promise<AiHealth[]> {
  const config = getConfig();
  const out: AiHealth[] = [];
  for (const tier of await tiers()) {
    const headers: Record<string, string> = {};
    if (tier.apiKey !== "") headers.authorization = `Bearer ${tier.apiKey}`;
    try {
      const response = await upstreamFetch(`${tier.baseUrl}/models`, {
        headers,
        timeoutMs: 6_000,
        direct: !config.aiUseProxy,
      });
      out.push({
        tier: tier.name,
        baseUrl: tier.baseUrl,
        model: tier.model,
        reachable: response.ok,
        note: response.ok ? "" : `answered ${response.status}`,
      });
    } catch (error) {
      out.push({
        tier: tier.name,
        baseUrl: tier.baseUrl,
        model: tier.model,
        reachable: false,
        note: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}
