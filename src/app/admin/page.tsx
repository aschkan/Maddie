import type { Metadata } from "next";

import AdminView from "@/components/AdminView";

export const metadata: Metadata = {
  title: "Maddie — admin",
  robots: { index: false, follow: false },
};

export default function Admin() {
  return <AdminView />;
}
