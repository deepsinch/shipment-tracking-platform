import { PackageSearchIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Missing ids, malformed ids and other companies' shipments all look the same. */
export default function ShipmentNotFound() {
  return (
    <main>
      <Card className="flex flex-col items-center gap-3 px-4 py-16 text-center">
        <PackageSearchIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-medium">Shipment not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          It may not exist, or it is not visible to your account.
        </p>
        <Button asChild variant="outline">
          <Link href="/dashboard/shipments">Back to shipments</Link>
        </Button>
      </Card>
    </main>
  );
}
