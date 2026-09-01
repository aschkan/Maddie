import { z } from "zod";
import { json, parseAt, parseBody } from "@/lib/api";
import { LatLngSchema } from "@/lib/domain";
import { assessRoutes } from "@/lib/scoring/route";

export const dynamic = "force-dynamic";

const Body = z.object({
  from: LatLngSchema,
  to: LatLngSchema,
  at: z.string().optional(),
});

/** The safest walking route, scored per segment — not the fastest one. */
export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(request, Body);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const outcome = await assessRoutes(body.from, body.to, parseAt(body.at ?? null));
  return json(outcome, outcome.routes.length === 0 ? 503 : 200);
}
