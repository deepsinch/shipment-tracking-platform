import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { canCreateShipments } from "@/domain/shipment-permissions";
import { requireAuthContext } from "@/server/auth/session";
import { listDrivers } from "@/server/services/list-drivers";

import { NewShipmentForm } from "./new-shipment-form";

export const metadata: Metadata = { title: "New shipment" };

export default async function NewShipmentPage() {
  const ctx = await requireAuthContext();
  // Drivers cannot create shipments (createShipment would answer `forbidden`). The list hides the
  // button for them; someone typing the URL is sent back to the list.
  if (!canCreateShipments(ctx.role)) redirect("/dashboard/shipments");
  const drivers = await listDrivers(ctx);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/shipments"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Shipments
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">New shipment</h1>
        <p className="text-sm text-muted-foreground">
          A tracking code is generated when you create it.
        </p>
      </div>
      <NewShipmentForm drivers={drivers.ok ? drivers.drivers : []} />
    </main>
  );
}
