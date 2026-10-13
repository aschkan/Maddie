import type { Metadata } from "next";

import CompareBoard from "@/components/CompareBoard";

export const metadata: Metadata = { title: "Maddie — Compare route evidence" };

export default function Compare() {
  return <CompareBoard />;
}
