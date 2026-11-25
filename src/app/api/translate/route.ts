/**
 * A story, translated to English, for reading inside the app.
 *
 * Server-side for the same reason as `/api/assess`: the model's key must not
 * be shipped to the browser. Same-origin, never forwarded through `/api/osm`.
 * Answers are kept in memory (bounded) because the same few hundred stories
 * are read over and over, and a story never changes.
 *
 * Two translators, in order: the app's model (Liara), then Google Translate's
 * public endpoint — the same service the old "Translate ↗" link opened, so no
 * text goes anywhere it did not already go. Fetched directly by this server;
 * on the box that cannot reach the internet both fail, and the page falls back
 * to the link.
 */

import { TRANSLATE_MAX_CHARS, translateToEnglish } from "@/lib/ai";

export const dynamic = "force-dynamic";

const CACHE_MAX = 2000;
const cache = new Map<string, string>();

export async function POST(request: Request): Promise<Response> {
  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    if (typeof body.text === "string") text = body.text.trim().slice(0, TRANSLATE_MAX_CHARS);
  } catch {
    // fall through to the 400
  }
  if (!text) return Response.json({ text: null, note: "send { text }" }, { status: 400 });

  const hit = cache.get(text);
  if (hit) return Response.json({ text: hit, cached: true });

  const model = await translateToEnglish(text, { timeoutMs: 12_000 });
  const out = model.text ? model : await viaGoogle(text);
  if (!out.text) return Response.json({ text: null, note: `${model.note ?? "model failed"}; ${out.note ?? "google failed"}` }, { status: 502 });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(text, out.text);
  return Response.json({ text: out.text });
}

/** Google Translate's public endpoint: auto-detect → English. Never throws. */
async function viaGoogle(text: string): Promise<{ text: string | null; note?: string }> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { text: null, note: `google answered ${response.status}` };
    const body = (await response.json()) as unknown;
    const parts = Array.isArray(body) && Array.isArray(body[0]) ? (body[0] as unknown[]) : [];
    const out = parts.map((part) => (Array.isArray(part) && typeof part[0] === "string" ? part[0] : "")).join("").trim();
    return out ? { text: out } : { text: null, note: "google returned nothing" };
  } catch (error) {
    return { text: null, note: error instanceof Error ? error.message : "google failed" };
  }
}
