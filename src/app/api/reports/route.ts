import { randomUUID } from "node:crypto";
import { badRequest, clientIdentity, json, numberParam, parseBody } from "@/lib/api";
import { ReportInputSchema, type CommunityReport } from "@/lib/domain";
import { addReport, anonHash, rateLimitReport, reportsNear } from "@/lib/store/repositories";
import { moderateReport } from "@/lib/ai/tasks";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Reports near a point, or all of them when no point is given. */
export async function GET(request: Request): Promise<Response> {
  const config = getConfig();
  const url = new URL(request.url);
  const centre = {
    lat: numberParam(url.searchParams.get("lat"), config.defaultCenter.lat),
    lng: numberParam(url.searchParams.get("lng"), config.defaultCenter.lng),
  };
  const radiusMetres = Math.min(20_000, Math.max(100, numberParam(url.searchParams.get("radiusMetres"), 1_500)));

  const near = await reportsNear(centre, radiusMetres);
  if (!near.measured) {
    return json(
      {
        measured: false,
        reports: [],
        note: "Community reports could not be read, so none are shown. That is a gap in the data, not an empty map.",
      },
      503,
    );
  }

  return json({
    measured: true,
    centre,
    radiusMetres,
    total: near.total,
    last90Days: near.last90Days,
    byCategory: near.byCategory,
    // The anonymising hash never leaves the server.
    reports: near.items.map(({ anonHash: _hash, ...rest }) => rest),
  });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(request, ReportInputSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;

  const identity = clientIdentity(request);
  const limit = await rateLimitReport(identity);
  if (!limit.allowed) {
    return json(
      { error: "rate-limited", message: `That is more than ${limit.limit} reports in an hour from here.` },
      429,
    );
  }

  if (input.text.trim() === "" && input.category === "other") {
    return badRequest("Tell us what happened, or pick a category.");
  }

  const verdict = await moderateReport(input.text);
  const report: CommunityReport = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    lat: input.lat,
    lng: input.lng,
    category: input.category,
    hour: input.hour,
    text: input.text.trim(),
    placeName: input.placeName.trim(),
    anonHash: anonHash(identity),
    status: verdict.publish ? "published" : "held",
    moderation: { flagged: !verdict.publish, reason: verdict.reason, byModel: verdict.reviewed },
  };
  await addReport(report);

  const { anonHash: _hash, ...visible } = report;
  return json(
    {
      report: visible,
      moderated: verdict.reviewed,
      note: verdict.reviewed
        ? null
        : "No moderation model was available, so this was published unreviewed rather than held back.",
    },
    201,
  );
}
