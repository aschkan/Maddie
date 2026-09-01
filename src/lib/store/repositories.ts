/**
 * Reads and writes for the four things that outlive a request: community
 * reports, research interviews, guardian journeys, and the operator's AI
 * settings.
 */
import { createHash, randomBytes } from "node:crypto";
import { getConfig } from "../config.ts";
import { getStore } from "./index.ts";
import type { CommunityReport, Interview, Journey, JourneyPing } from "../domain.ts";
import type { ReportCategory, ReportsSummary } from "../scoring/dimensions.ts";
import { haversineMetres } from "../geo/distance.ts";
import type { LatLng } from "../geo/wkt.ts";

const REPORTS = "maddie:reports";
const INTERVIEWS = "maddie:interviews";
const AI_SETTINGS = "maddie:ai-settings";
const journeyKey = (token: string): string => `maddie:journey:${token}`;

/**
 * Anonymises a reporter. With no salt configured this refuses to produce a
 * stable hash at all: a known (or empty) salt makes the rate-limit hashes
 * guessable, which is worse than not having them.
 */
export function anonHash(identity: string): string {
  const salt = getConfig().anonHashSalt;
  if (salt === "") return `unsalted:${createHash("sha256").update(identity).digest("hex").slice(0, 8)}`;
  return createHash("sha256").update(`${salt}:${identity}`).digest("hex").slice(0, 32);
}

export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function listReports(): Promise<CommunityReport[]> {
  return getStore().list<CommunityReport>(REPORTS);
}

export async function addReport(report: CommunityReport): Promise<void> {
  await getStore().append(REPORTS, report, 20_000);
}

export async function rateLimitReport(identity: string): Promise<{ allowed: boolean; count: number; limit: number }> {
  const config = getConfig();
  const hour = Math.floor(Date.now() / 3_600_000);
  const count = await getStore().increment(`maddie:ratelimit:${anonHash(identity)}:${hour}`, 3_600);
  return { allowed: count <= config.reportRateLimitPerHour, count, limit: config.reportRateLimitPerHour };
}

const EMPTY_CATEGORIES: Record<ReportCategory, number> = {
  harassment: 0,
  following: 0,
  assault: 0,
  lighting: 0,
  feltUnsafe: 0,
  feltSafe: 0,
  other: 0,
};

/**
 * Reports near a point. `measured` is false when the store could not be read —
 * "nobody reported anything here" and "we could not check" are different
 * claims and the scoring layer treats them differently.
 */
export async function reportsNear(point: LatLng, radiusMetres: number): Promise<ReportsSummary & { items: CommunityReport[] }> {
  let all: CommunityReport[];
  try {
    all = await listReports();
  } catch {
    return { measured: false, total: 0, last90Days: 0, byCategory: { ...EMPTY_CATEGORIES }, items: [] };
  }

  const cutoff = Date.now() - 90 * 24 * 3_600_000;
  const byCategory = { ...EMPTY_CATEGORIES };
  const items: CommunityReport[] = [];
  let last90Days = 0;

  for (const report of all) {
    if (report.status !== "published") continue;
    if (haversineMetres(point, { lat: report.lat, lng: report.lng }) > radiusMetres) continue;
    items.push(report);
    byCategory[report.category] += 1;
    if (Date.parse(report.createdAt) >= cutoff) last90Days += 1;
  }

  return { measured: true, total: items.length, last90Days, byCategory, items };
}

export async function listInterviews(): Promise<Interview[]> {
  return getStore().list<Interview>(INTERVIEWS);
}

export async function addInterview(interview: Interview): Promise<void> {
  await getStore().append(INTERVIEWS, interview, 5_000);
}

export async function interviewsNear(point: LatLng, radiusMetres: number): Promise<Interview[]> {
  try {
    const all = await listInterviews();
    return all.filter((item) => haversineMetres(point, { lat: item.lat, lng: item.lng }) <= radiusMetres);
  } catch {
    return [];
  }
}

export async function saveJourney(journey: Journey): Promise<void> {
  const ttl = Math.max(60, Math.round((Date.parse(journey.expiresAt) - Date.now()) / 1000));
  await getStore().set(journeyKey(journey.token), journey, ttl);
}

export async function getJourney(token: string): Promise<Journey | null> {
  const journey = await getStore().get<Journey>(journeyKey(token));
  if (journey === null) return null;
  if (Date.parse(journey.expiresAt) <= Date.now()) return { ...journey, status: "expired" };
  return journey;
}

export async function pushJourneyPing(token: string, ping: JourneyPing): Promise<Journey | null> {
  const journey = await getJourney(token);
  if (journey === null || journey.status === "expired") return null;
  const updated: Journey = {
    ...journey,
    status: ping.status,
    // A watched journey is short; keeping the whole trail is cheap and it is
    // the thing a watcher actually wants to see.
    pings: [...journey.pings, ping].slice(-500),
  };
  await saveJourney(updated);
  return updated;
}

export interface AiSettings {
  localUrl: string;
  localModel: string;
  localVisionModel: string;
  cloudBase: string;
  cloudModel: string;
  cloudVisionModel: string;
  localFirst: boolean;
  taskModels: Record<string, string>;
}

export async function getAiSettings(): Promise<Partial<AiSettings> | null> {
  try {
    return await getStore().get<Partial<AiSettings>>(AI_SETTINGS);
  } catch {
    return null;
  }
}

export async function saveAiSettings(settings: Partial<AiSettings>): Promise<void> {
  await getStore().set(AI_SETTINGS, settings);
}
