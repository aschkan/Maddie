import type { Metadata } from "next";
import { Suspense } from "react";

import AreaFromQuery from "@/components/AreaFromQuery";

export const metadata: Metadata = { title: "Maddie — Area in detail" };

export default function Area() {
  // `useSearchParams` below renders client-side up to this boundary; the rest
  // of the page is still prerendered.
  return (
    <Suspense fallback={<main className="board"><p className="empty">Loading…</p></main>}>
      <AreaFromQuery />
    </Suspense>
  );
}
