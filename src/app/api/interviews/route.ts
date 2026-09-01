import { randomUUID } from "node:crypto";
import { json, numberParam, parseBody, requireAdmin } from "@/lib/api";
import { InterviewInputSchema, type Interview } from "@/lib/domain";
import { addInterview, interviewsNear, listInterviews } from "@/lib/store/repositories";
import { analyseInterview } from "@/lib/ai/tasks";

export const dynamic = "force-dynamic";

/**
 * Research interviews, geotagged. Transcripts are given in confidence, which
 * is one of the reasons the model tier is local-first.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");
  const full = url.searchParams.get("full") === "true";

  const interviews =
    lat !== null && lng !== null
      ? await interviewsNear(
          { lat: numberParam(lat, 0), lng: numberParam(lng, 0) },
          Math.min(50_000, Math.max(100, numberParam(url.searchParams.get("radiusMetres"), 3_000))),
        )
      : await listInterviews();

  // The transcript is only served in full to an operator; the public surface
  // gets the themes and the summary.
  const admin = requireAdmin(request) === null;
  return json({
    total: interviews.length,
    interviews: interviews.map((interview) =>
      admin && full ? interview : { ...interview, transcript: "" },
    ),
  });
}

export async function POST(request: Request): Promise<Response> {
  const refusal = requireAdmin(request);
  if (refusal !== null) return refusal;

  const parsed = await parseBody(request, InterviewInputSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;

  const analysis = await analyseInterview(input.transcript);
  const interview: Interview = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    lat: input.lat,
    lng: input.lng,
    title: input.title,
    pseudonym: input.pseudonym,
    locationLabel: input.locationLabel,
    transcript: input.transcript,
    themes: analysis.themes,
    summary: analysis.summary,
    analysed: analysis.analysed,
  };
  await addInterview(interview);

  return json(
    {
      interview: { ...interview, transcript: "" },
      note: analysis.analysed
        ? null
        : "No model was available, so this interview was stored without themes or a summary rather than with invented ones.",
    },
    201,
  );
}
