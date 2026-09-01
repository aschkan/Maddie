/** Small helpers shared by the client surfaces. */

export const DEFAULT_CENTRE = {
  lat: Number(process.env.NEXT_PUBLIC_DEFAULT_CENTER_LAT ?? "52.3728"),
  lng: Number(process.env.NEXT_PUBLIC_DEFAULT_CENTER_LNG ?? "4.8936"),
};

/** `datetime-local` value for a Date, in the browser's own zone. */
export function toLocalInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * TRAP: a helper named `useX` trips react-hooks/rules-of-hooks even when it is
 * not a hook. Predicates are named `xSelected()` instead.
 */
export function nightSelected(at: Date): boolean {
  const hour = at.getHours();
  return hour >= 21 || hour < 6;
}

export async function getJson<T>(url: string): Promise<{ ok: boolean; status: number; body: T }> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const body = (await response.json()) as T;
  return { ok: response.ok, status: response.status, body };
}

export async function postJson<T>(url: string, payload: unknown): Promise<{ ok: boolean; status: number; body: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T;
  return { ok: response.ok, status: response.status, body };
}

/**
 * TRAP: `navigator.clipboard` does not exist on a non-secure origin. An admin
 * panel or a preview reached over plain HTTP or an SSH tunnel needs the
 * execCommand fallback, or the copy button silently does nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  document.body.removeChild(area);
  return copied;
}

export function metres(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
}

export function minutes(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}
