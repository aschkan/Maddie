import type { Metadata } from "next";

import CompareBoard from "@/components/CompareBoard";

export const metadata: Metadata = { title: "Maddie — Plan a route" };

/** The landing page is the three-route comparison: it says what the tool is for on its own. */
export default function Home() {
  return <CompareBoard />;
}
