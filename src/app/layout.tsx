import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maddie — routes, lighting and what the map knows",
  description:
    "Set a start and a destination on an OpenStreetMap map, compare the ways round, " +
    "and see what OpenStreetMap records about the lighting and the places along each one.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The map is full-height; a zooming viewport fights Leaflet's own gestures.
  maximumScale: 1,
};

/**
 * Set the theme before the first paint.
 *
 * React cannot do this: `localStorage` does not exist during the server render,
 * so the first HTML is always the default theme and the correction lands after
 * hydration — a white flash on every load, on a page people open at night.
 * This runs synchronously in <head>, before anything is drawn.
 */
const THEME_SCRIPT = `
try {
  var saved = localStorage.getItem("maddie.theme.v1");
  var dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch (e) {
  document.documentElement.dataset.theme = "dark";
}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
