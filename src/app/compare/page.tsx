import { redirect } from "next/navigation";

/** The comparison is the landing page now; old links still arrive there. */
export default function Compare() {
  redirect("/");
}
