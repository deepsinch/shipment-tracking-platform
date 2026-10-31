import type { Metadata } from "next";

import { ROLE_LABELS } from "@/domain/roles";
import { requireAuthContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

// Placeholder until the shipments dashboard (checkpoint 5).
export default async function DashboardPage() {
  const { role } = await requireAuthContext();
  return (
    <main>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p>You are signed in as {ROLE_LABELS[role].toLowerCase()}.</p>
    </main>
  );
}
