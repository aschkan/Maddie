import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Route",
  description: "Pick a start and a destination on an OpenStreetMap map and get a route.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The map is full-height; a zooming viewport fights Leaflet's own gestures.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
