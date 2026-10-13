"use client";

import { useSearchParams } from "next/navigation";

import AreaBoard from "@/components/AreaBoard";

/** `/area?d=<district>` → the board for that district. */
export default function AreaFromQuery() {
  const params = useSearchParams();
  const id = params.get("d");
  return <AreaBoard key={id ?? ""} districtId={id} />;
}
