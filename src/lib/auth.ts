/**
 * The study team's login — one password, one signed cookie. SERVER ONLY.
 *
 * Two secrets, both in this app's own `.env` and both DECLARED in the platform
 * proxy's `platforms.json` (`"secrets": ["ADMIN_PASSWORD", "SESSION_SECRET"]`),
 * so the panel's 🔑 Fix secrets generates them and never rotates them:
 *
 *   * `ADMIN_PASSWORD` — what the team types at `/admin`. The seed prints it.
 *   * `SESSION_SECRET` — signs the session cookie. Rotating it signs everyone out.
 *
 * Read PER CALL, never captured at module scope: pm2 replays a saved
 * environment, and a value captured once is how a panel ends up answering to a
 * password that exists nowhere but an old dump.
 *
 * Neither set → the admin area says it is not configured, and refuses. There is
 * no default password, because a default in a public repository is a password
 * everybody has.
 *
 * Why it matters what sits behind it: the interviews (real participants, under
 * a consent form) and every write that is not a public community report.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "maddie_admin";
/** A week. Long enough not to nag a researcher, short enough to expire a lost laptop. */
export const SESSION_TTL_S = 7 * 24 * 3600;
export const ADMIN_USER = "admin";

export function adminPassword(): string | null {
  const value = process.env.ADMIN_PASSWORD?.trim();
  return value ? value : null;
}

function sessionSecret(): string | null {
  const value = process.env.SESSION_SECRET?.trim();
  return value ? value : null;
}

export function adminConfigured(): boolean {
  return adminPassword() !== null && sessionSecret() !== null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Equal-time string compare; different lengths are simply unequal. */
export function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `<expiry>.<signature>` — nothing in it but when it runs out. */
export function makeSession(secret: string, nowMs: number, ttlS = SESSION_TTL_S): string {
  const expires = String(Math.floor(nowMs / 1000) + ttlS);
  return `${expires}.${sign(expires, secret)}`;
}

export function checkSession(token: string | undefined | null, secret: string, nowMs: number): boolean {
  if (!token) return false;
  const [expires, signature, extra] = token.split(".");
  if (!expires || !signature || extra !== undefined || !/^\d+$/.test(expires)) return false;
  if (!sameText(signature, sign(expires, secret))) return false;
  return Number(expires) * 1000 > nowMs;
}

export function passwordOk(given: string): boolean {
  const expected = adminPassword();
  return expected !== null && sameText(given, expected);
}

export function newSession(): string | null {
  const secret = sessionSecret();
  return secret ? makeSession(secret, Date.now()) : null;
}

export function sessionValid(token: string | undefined | null): boolean {
  const secret = sessionSecret();
  return secret !== null && checkSession(token, secret, Date.now());
}

/** The cookie out of a raw `Cookie:` header, for route handlers. */
export function cookieFrom(header: string | null, name = SESSION_COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function isAdminRequest(request: Request): boolean {
  return sessionValid(cookieFrom(request.headers.get("cookie")));
}

/**
 * Login attempts per client, in memory. Ten tries per ten minutes is plenty for
 * a person and useless for a guesser. Per box (two boxes double it) — fine.
 */
const attempts = new Map<string, number[]>();
export const LOGIN_WINDOW_MS = 10 * 60_000;
export const LOGIN_MAX = 10;

export function loginAllowed(client: string, nowMs: number, store = attempts): boolean {
  const recent = (store.get(client) ?? []).filter((t) => nowMs - t < LOGIN_WINDOW_MS);
  store.set(client, recent);
  if (store.size > 5_000) store.clear();
  return recent.length < LOGIN_MAX;
}

export function noteAttempt(client: string, nowMs: number, store = attempts): void {
  store.set(client, [...(store.get(client) ?? []), nowMs]);
}

/** The visitor's address as the platform proxy reports it. */
export function clientOf(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}
