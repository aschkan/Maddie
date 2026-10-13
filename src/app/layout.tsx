import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

import EvidenceProvider from "@/components/EvidenceProvider";

export const metadata: Metadata = {
  title: "Maddie — Explore urban mobility evidence",
  description:
    "An evidence dashboard: community reports, mapped lighting and nearby places, " +
    "and the ways round from A to B compared factor by factor. No overall safety score.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
  var dark = saved === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch (e) {
  document.documentElement.dataset.theme = "light";
}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <EvidenceProvider>{children}</EvidenceProvider>
      </body>
    </html>
  );
}
