import { redirect } from "next/navigation";

/**
 * The area board is gone: its numbers show inline when a neighbourhood is
 * tapped in "Around me", and its analytics are on the data dashboard.
 */
export default function Area() {
  redirect("/dashboard");
}
