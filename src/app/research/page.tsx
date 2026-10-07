import type { Metadata } from "next";

import ResearchView from "@/components/ResearchView";

export const metadata: Metadata = {
  title: "Maddie — interviews",
  // The study's own data. Not something a search engine should list.
  robots: { index: false, follow: false },
};

export default function Research() {
  return <ResearchView />;
}
