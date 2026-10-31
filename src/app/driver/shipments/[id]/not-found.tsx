import { PackageSearchIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Unknown ids and shipments assigned to someone else look the same. */
export default function DriverShipmentNotFound() {
  return (
    <main>
      <Card className="flex flex-col items-center gap-3 px-4 py-16 text-center">
        <PackageSearchIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-medium">Shipment not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          It may not exist, or it is no longer assigned to you.
        </p>
        <Button asChild variant="outline" size="lg">
          <Link href="/driver">Back to my shipments</Link>
        </Button>
      </Card>
    </main>
  );
}
