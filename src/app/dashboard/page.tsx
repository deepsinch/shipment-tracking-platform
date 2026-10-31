import { redirect } from "next/navigation";

import { requireAuthContextOn } from "@/server/auth/session";

export default async function DashboardPage() {
  await requireAuthContextOn("/dashboard");
  redirect("/dashboard/shipments");
}
