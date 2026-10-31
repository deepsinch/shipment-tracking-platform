import { redirect } from "next/navigation";

import { requireAuthContext } from "@/server/auth/session";

export default async function DashboardPage() {
  await requireAuthContext();
  redirect("/dashboard/shipments");
}
