import { json, parseBody } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { JourneyInputSchema, type Journey } from "@/lib/domain";
import { newToken, saveJourney } from "@/lib/store/repositories";

export const dynamic = "force-dynamic";

/**
 * Creates a journey somebody can be watched on.
 *
 * The share link is ABSOLUTE and built from NEXT_PUBLIC_APP_URL. A link to
 * 127.0.0.1:8087 fails at exactly the moment someone is relying on it to see
 * where a woman is, so a misconfigured origin is reported rather than papered
 * over with a relative URL that will not travel.
 */
export async function POST(request: Request): Promise<Response> {
  const config = getConfig();
  const parsed = await parseBody(request, JourneyInputSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;

  const now = Date.now();
  const journey: Journey = {
    token: newToken(),
    createdAt: new Date(now).toISOString(),
    // The link outlives the walk by an hour, and no longer: a watch link that
    // never expires is a tracking link.
    expiresAt: new Date(now + (input.expectedMinutes + 60) * 60_000).toISOString(),
    from: input.from,
    to: input.to,
    fromLabel: input.fromLabel,
    toLabel: input.toLabel,
    watcherName: input.watcherName,
    expectedMinutes: input.expectedMinutes,
    status: "walking",
    pings: [],
  };
  await saveJourney(journey);

  const origin = config.appUrl !== "" ? config.appUrl : new URL(request.url).origin;
  const isLoopback = /^https?:\/\/(127\.|localhost|\[?::1)/i.test(origin);

  return json(
    {
      token: journey.token,
      watchUrl: `${origin}/watch/${journey.token}`,
      expiresAt: journey.expiresAt,
      note: isLoopback
        ? "NEXT_PUBLIC_APP_URL is not set to the public origin, so this link only works on this machine. Set it before relying on it."
        : null,
    },
    201,
  );
}
