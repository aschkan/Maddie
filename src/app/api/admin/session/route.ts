/**
 * Sign in and out of `/admin`. One password (`ADMIN_PASSWORD`), one signed,
 * HttpOnly cookie. Ten attempts per client per ten minutes.
 */

import { NextResponse } from "next/server";

import {
  adminConfigured, clientOf, isAdminRequest, loginAllowed, newSession, noteAttempt, passwordOk,
  SESSION_COOKIE, SESSION_TTL_S,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED =
  "The admin area is not configured on this server: ADMIN_PASSWORD and SESSION_SECRET are not set. " +
  "Press 🔑 Fix secrets on the platform card, then restart Maddie.";

export async function GET(request: Request) {
  return NextResponse.json({ configured: adminConfigured(), signedIn: isAdminRequest(request) });
}

export async function POST(request: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  const client = clientOf(request);
  const now = Date.now();
  if (!loginAllowed(client, now)) {
    return NextResponse.json({ error: "Too many attempts. Wait ten minutes and try again." }, { status: 429 });
  }
  let password = "";
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? "");
  } catch {
    // An unreadable body is a wrong password.
  }
  if (!passwordOk(password)) {
    noteAttempt(client, now);
    return NextResponse.json({ error: "That password is not right." }, { status: 401 });
  }
  const token = newSession();
  if (!token) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  const response = NextResponse.json({ signedIn: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // The platform proxy terminates TLS; in production every request reached it over https.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ signedIn: false });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
