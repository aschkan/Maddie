import type { Metadata } from "next";

import DashboardBoard from "@/components/DashboardBoard";

export const metadata: Metadata = { title: "Maddie — Data dashboard" };

export default function Dashboard() {
  return <DashboardBoard />;
}
