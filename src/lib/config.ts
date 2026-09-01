import { DEFAULT_MAP_STYLE_URL } from "./map/proxy.ts";

/**
 * Every environment variable Maddie reads, parsed exactly once.
 *
 * Two rules hold throughout:
 *  - the app must start and serve with a completely empty environment; a key
 *    may only ever buy a *better* answer, never a working one;
 *  - a missing value is never quietly replaced by a value that reads like a
 *    measurement. Absent is absent, and the surfaces say so.
 */

export type Env = Record<string, string | undefined>;

export function str(env: Env, key: string, fallback = ""): string {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed === "" ? fallback : trimmed;
}

export function num(env: Env, key: string, fallback: number): number {
  const raw = str(env, key);
  if (raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function bool(env: Env, key: string, fallback: boolean): boolean {
  const raw = str(env, key).toLowerCase();
  if (raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

/** Comma- (or semicolon-) separated list, empties dropped. */
export function list(env: Env, key: string, fallback: string[] = []): string[] {
  const raw = str(env, key);
  if (raw === "") return fallback;
  const parts = raw
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length > 0 ? parts : fallback;
}

export type GeocodingProvider = "pdok" | "nominatim" | "google" | "auto";

export interface MaddieConfig {
  appUrl: string;
  region: string;
  defaultCenter: { lat: number; lng: number };
  geocodingCountry: string;

  pdokUrl: string;
  crimeODataUrl: string;
  crimeTable: string;
  crimeWindowMonths: number;
  crimeEnabled: boolean;

  proxyPool: string[];
  proxyBypass: string[];
  proxyProbeUrl: string;
  proxyProbeIntervalMs: number;
  upstreamTimeoutMs: number;

  mapStyleUrl: string;
  mapTilesUpstream: string;

  googleMapsKey: string;
  mapillaryToken: string;

  geocodingProvider: GeocodingProvider;
  routingProvider: string;
  venuesProvider: string;
  imageryProvider: string;
  nominatimContactEmail: string;
  nominatimUrl: string;
  valhallaUrl: string;
  weatherUrl: string;
  weatherEnabled: boolean;

  localAiUrl: string;
  localAiModel: string;
  localAiVisionModel: string;
  aiLocalFirst: boolean;
  aiTaskModels: Record<string, string>;
  cloudAiBase: string;
  cloudAiKey: string;
  cloudAiModel: string;
  cloudAiVisionModel: string;
  cloudAiProvider: string;
  aiUseProxy: boolean;
  aiProxyUrl: string[];
  aiMaxConcurrent: number;
  aiTimeoutMs: number;
  aiEnabled: boolean;

  adminToken: string;
  upstashUrl: string;
  upstashToken: string;
  dataDir: string;

  overpassEndpoints: string[];
  overpassMaxConcurrent: number;
  overpassMinIntervalMs: number;
  overpassTimeoutMs: number;
  overpassDeadlineMs: number;
  osmEnabled: boolean;

  streetViewEnabled: boolean;
  streetViewMaxImages: number;

  emergencyNumber: string;
  reportRateLimitPerHour: number;
  anonHashSalt: string;
  logLevel: string;
}

function parseTaskModels(raw: string): Record<string, string> {
  if (raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim() !== "") out[key] = value.trim();
    }
    return out;
  } catch {
    // A malformed override must not take the AI tier down with it.
    return {};
  }
}

function localAiUrl(env: Env): string {
  const explicit = str(env, "LOCAL_AI_URL");
  if (explicit.toLowerCase() === "off") return "";
  if (explicit !== "") return explicit.replace(/\/+$/, "");
  const host = str(env, "LOCAL_AI_HOST");
  if (host === "") return "";
  return `http://${host}:1234/v1`;
}

export function loadConfig(env: Env): MaddieConfig {
  const provider = str(env, "GEOCODING_PROVIDER", "pdok").toLowerCase();
  const geocodingProvider: GeocodingProvider =
    provider === "nominatim" || provider === "google" || provider === "auto" ? provider : "pdok";

  return {
    appUrl: str(env, "NEXT_PUBLIC_APP_URL").replace(/\/+$/, ""),
    region: str(env, "REGION", "NL").toUpperCase(),
    defaultCenter: {
      lat: num(env, "DEFAULT_CENTER_LAT", 52.3728),
      lng: num(env, "DEFAULT_CENTER_LNG", 4.8936),
    },
    geocodingCountry: str(env, "GEOCODING_COUNTRY", "nl").toLowerCase(),

    pdokUrl: str(env, "PDOK_LOCATIESERVER_URL", "https://api.pdok.nl/bzk/locatieserver/search/v3_1").replace(/\/+$/, ""),
    crimeODataUrl: str(env, "NL_CRIME_ODATA_URL", "https://dataderden.cbs.nl/ODataApi/odata").replace(/\/+$/, ""),
    crimeTable: str(env, "NL_CRIME_TABLE", "47022NED"),
    crimeWindowMonths: Math.max(1, Math.min(60, num(env, "NL_CRIME_WINDOW_MONTHS", 12))),
    crimeEnabled: bool(env, "CRIME_DATA_ENABLED", true),

    proxyPool: list(env, "UPSTREAM_PROXY_URL"),
    proxyBypass: list(env, "UPSTREAM_PROXY_BYPASS").map((host) => host.toLowerCase()),
    proxyProbeUrl: str(env, "UPSTREAM_PROXY_PROBE_URL", "https://api.pdok.nl/"),
    proxyProbeIntervalMs: num(env, "UPSTREAM_PROXY_PROBE_INTERVAL_MS", 600_000),
    upstreamTimeoutMs: num(env, "UPSTREAM_TIMEOUT_MS", 20_000),

    mapStyleUrl: str(env, "NEXT_PUBLIC_MAP_STYLE_URL", DEFAULT_MAP_STYLE_URL),
    mapTilesUpstream: str(env, "MAP_TILES_UPSTREAM", "https://tiles.openfreemap.org").replace(/\/+$/, ""),

    googleMapsKey: str(env, "GOOGLE_MAPS_SERVER_API_KEY"),
    mapillaryToken: str(env, "MAPILLARY_TOKEN"),

    geocodingProvider,
    routingProvider: str(env, "ROUTING_PROVIDER", "valhalla"),
    venuesProvider: str(env, "VENUES_PROVIDER", "auto"),
    imageryProvider: str(env, "IMAGERY_PROVIDER", "auto"),
    nominatimContactEmail: str(env, "NOMINATIM_CONTACT_EMAIL"),
    nominatimUrl: str(env, "NOMINATIM_URL", "https://nominatim.openstreetmap.org").replace(/\/+$/, ""),
    valhallaUrl: str(env, "VALHALLA_URL", "https://valhalla1.openstreetmap.de/route"),
    weatherUrl: str(env, "WEATHER_URL", "https://api.open-meteo.com/v1/forecast"),
    weatherEnabled: bool(env, "WEATHER_ENABLED", true),

    localAiUrl: localAiUrl(env),
    localAiModel: str(env, "LOCAL_AI_MODEL", "gemma-3-4b-it"),
    localAiVisionModel: str(env, "LOCAL_AI_VISION_MODEL"),
    aiLocalFirst: bool(env, "AI_LOCAL_FIRST", true),
    aiTaskModels: parseTaskModels(str(env, "AI_TASK_MODELS")),
    cloudAiBase: str(env, "CLOUD_AI_BASE").replace(/\/+$/, ""),
    cloudAiKey: str(env, "CLOUD_AI_KEY"),
    cloudAiModel: str(env, "CLOUD_AI_MODEL"),
    cloudAiVisionModel: str(env, "CLOUD_AI_VISION_MODEL"),
    cloudAiProvider: str(env, "CLOUD_AI_PROVIDER"),
    aiUseProxy: bool(env, "AI_USE_PROXY", false),
    aiProxyUrl: list(env, "AI_PROXY_URL"),
    aiMaxConcurrent: Math.max(1, num(env, "AI_MAX_CONCURRENT", 4)),
    aiTimeoutMs: num(env, "AI_TIMEOUT_MS", 45_000),
    aiEnabled: bool(env, "AI_ENABLED", true),

    adminToken: str(env, "ADMIN_TOKEN"),
    upstashUrl: str(env, "UPSTASH_REDIS_REST_URL").replace(/\/+$/, ""),
    upstashToken: str(env, "UPSTASH_REDIS_REST_TOKEN"),
    dataDir: str(env, "MADDIE_DATA_DIR", ".data"),

    overpassEndpoints: list(env, "OVERPASS_ENDPOINTS", ["http://127.0.0.1:12345/api/interpreter"]),
    overpassMaxConcurrent: Math.max(1, num(env, "OVERPASS_MAX_CONCURRENT", 1)),
    overpassMinIntervalMs: Math.max(0, num(env, "OVERPASS_MIN_INTERVAL_MS", 0)),
    overpassTimeoutMs: num(env, "OVERPASS_TIMEOUT_MS", 20_000),
    overpassDeadlineMs: num(env, "OVERPASS_DEADLINE_MS", 15_000),
    osmEnabled: bool(env, "OSM_ENABLED", true),

    streetViewEnabled: bool(env, "STREET_VIEW_ANALYSIS_ENABLED", true),
    streetViewMaxImages: Math.max(0, Math.min(12, num(env, "STREET_VIEW_MAX_IMAGES", 4))),

    emergencyNumber: str(env, "NEXT_PUBLIC_EMERGENCY_NUMBER", "112"),
    reportRateLimitPerHour: Math.max(1, num(env, "REPORT_RATE_LIMIT_PER_HOUR", 12)),
    anonHashSalt: str(env, "ANON_HASH_SALT"),
    logLevel: str(env, "LOG_LEVEL", "info").toLowerCase(),
  };
}

let cached: MaddieConfig | null = null;

export function getConfig(): MaddieConfig {
  if (cached === null) cached = loadConfig(process.env as Env);
  return cached;
}

/** Test seam: forget the memoised config so a fresh environment is read. */
export function resetConfig(): void {
  cached = null;
}
