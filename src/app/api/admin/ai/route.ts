import { z } from "zod";
import { json, parseBody, requireAdmin } from "@/lib/api";
import { aiHealth } from "@/lib/ai/client";
import { getAiSettings, saveAiSettings } from "@/lib/store/repositories";

export const dynamic = "force-dynamic";

const Settings = z
  .object({
    localUrl: z.string().max(300).optional(),
    localModel: z.string().max(200).optional(),
    localVisionModel: z.string().max(200).optional(),
    cloudBase: z.string().max(300).optional(),
    cloudModel: z.string().max(200).optional(),
    cloudVisionModel: z.string().max(200).optional(),
    localFirst: z.boolean().optional(),
    taskModels: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/** Change AI endpoints and models with no redeploy. Operator token required. */
export async function GET(request: Request): Promise<Response> {
  const refusal = requireAdmin(request);
  if (refusal !== null) return refusal;
  return json({ settings: (await getAiSettings()) ?? {}, health: await aiHealth() });
}

export async function POST(request: Request): Promise<Response> {
  const refusal = requireAdmin(request);
  if (refusal !== null) return refusal;
  const parsed = await parseBody(request, Settings);
  if (!parsed.ok) return parsed.response;
  const merged = { ...((await getAiSettings()) ?? {}), ...parsed.value };
  await saveAiSettings(merged);
  return json({ settings: merged, health: await aiHealth() });
}
