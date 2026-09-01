import { z } from "zod";
import { json, parseBody, parseAt, numberParam } from "@/lib/api";
import { assessPoint } from "@/lib/scoring/assess";

export const dynamic = "force-dynamic";

const Body = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  at: z.string().optional(),
  radiusMetres: z.number().min(80).max(2_000).optional(),
  withImagery: z.boolean().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const parsed = await parseBody(request, Body);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const assessment = await assessPoint({
    point: { lat: body.lat, lng: body.lng },
    at: parseAt(body.at ?? null),
    radiusMetres: body.radiusMetres,
    withImagery: body.withImagery ?? false,
  });

  // `basis` and `totalCount` are surfaced at the top level as well as inside
  // the crime signal: anything reading `incidents.length` as the quantity
  // reports zero crime everywhere, and this is the antidote.
  return json({
    ...assessment,
    basis: assessment.crime.available ? assessment.crime.value.basis : null,
    totalCount: assessment.crime.available ? assessment.crime.value.totalCount : null,
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = numberParam(url.searchParams.get("lat"), NaN);
  const lng = numberParam(url.searchParams.get("lng"), NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: "bad-request", message: "lat and lng are required." }, 400);
  }
  const assessment = await assessPoint({
    point: { lat, lng },
    at: parseAt(url.searchParams.get("at")),
    radiusMetres: numberParam(url.searchParams.get("radiusMetres"), 350),
    withImagery: url.searchParams.get("withImagery") === "true",
  });
  return json({
    ...assessment,
    basis: assessment.crime.available ? assessment.crime.value.basis : null,
    totalCount: assessment.crime.available ? assessment.crime.value.totalCount : null,
  });
}
