import type { Metadata, Viewport } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { Nav } from "@/components/Nav";
import { EmergencyBar } from "@/components/EmergencyBar";

export const metadata: Metadata = {
  title: "Maddie — is this place safe, at this hour?",
  description:
    "Safety-ranked places and walking routes for the Netherlands, with the gaps in what we could see reported as gaps.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">{children}</main>
        <EmergencyBar />
      </body>
    </html>
  );
}
