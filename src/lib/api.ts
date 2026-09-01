/**
 * Shared API-route plumbing. Every boundary is validated with Zod, and every
 * failure says which of the three states it is: measured, measured-and-empty,
 * or not measured.
 */
import type { z } from "zod";
import { getConfig } from "./config.ts";
import { logger } from "./log.ts";

const log = logger("api");

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function badRequest(message: string, detail?: unknown): Response {
  return json({ error: "bad-request", message, detail }, 400);
}

export function serverError(message: string): Response {
  return json({ error: "server-error", message }, 500);
}

/**
 * ADMIN_TOKEN unset means OFF: the endpoint refuses everyone rather than
 * defaulting open. An operator endpoint that is accidentally public is worse
 * than one that is accidentally unavailable.
 */
export function requireAdmin(request: Request): Response | null {
  const token = getConfig().adminToken;
  if (token === "") {
    return json(
      {
        error: "admin-disabled",
        message: "ADMIN_TOKEN is not set on this deployment, so operator endpoints are switched off.",
      },
      503,
    );
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length !== token.length || provided !== token) {
    return json({ error: "unauthorised", message: "A valid operator token is required." }, 401);
  }
  return null;
}

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: badRequest("The request body was not valid JSON.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest("The request body did not match the expected shape.", parsed.error.issues) };
  }
  return { ok: true, value: parsed.data };
}

export function parseQuery<T>(url: URL, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; response: Response } {
  const raw: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) raw[key] = value;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: badRequest("The query string did not match the expected shape.", parsed.error.issues) };
  }
  return { ok: true, value: parsed.data };
}

export function numberParam(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** `at` is always explicit: every score in this app is for a stated moment. */
export function parseAt(value: string | null): Date {
  if (value === null || value === "") return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function clientIdentity(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim() ?? "";
  if (first !== "") return first;
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function logRoute(route: string, detail: unknown): void {
  log.debug(route, detail);
}
