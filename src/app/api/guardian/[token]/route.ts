import { json, parseBody } from "@/lib/api";
import { JourneyUpdateSchema } from "@/lib/domain";
import { getJourney, pushJourneyPing } from "@/lib/store/repositories";

export const dynamic = "force-dynamic";

/** What a watcher sees. The token is the only credential; it expires. */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params;
  const journey = await getJourney(token);
  if (journey === null) {
    return json(
      {
        error: "not-found",
        message: "That link is not valid any more. It may have expired, which is by design — a watch link that never expires is a tracking link.",
      },
      404,
    );
  }
  return json({ journey });
}

/** A position update from the person walking. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params;
  const parsed = await parseBody(request, JourneyUpdateSchema.omit({ token: true }));
  if (!parsed.ok) return parsed.response;

  const journey = await pushJourneyPing(token, {
    at: new Date().toISOString(),
    lat: parsed.value.lat,
    lng: parsed.value.lng,
    status: parsed.value.status,
    note: parsed.value.note,
  });
  if (journey === null) {
    return json({ error: "not-found", message: "That journey has expired or does not exist." }, 404);
  }
  return json({ journey });
}
