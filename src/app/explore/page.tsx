import type { Metadata } from "next";

import ExploreBoard from "@/components/ExploreBoard";

export const metadata: Metadata = { title: "Maddie — Around me" };

export default function Explore() {
  return <ExploreBoard />;
}
