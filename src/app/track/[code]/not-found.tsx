import { PackageSearchIcon } from "lucide-react";

import { TrackForm } from "@/components/track-form";
import { Card, CardContent } from "@/components/ui/card";

/** Unknown and malformed codes get the same answer, so codes cannot be probed by the message. */
export default function TrackingNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6 sm:py-10">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
          <PackageSearchIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-xl font-semibold tracking-tight">We could not find that shipment</h1>
          <p className="max-w-sm text-sm text-balance text-muted-foreground">
            Check the tracking code in your confirmation. It looks like WB-7K3M-Q9TX: letters and
            numbers in two groups of four.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <TrackForm />
        </CardContent>
      </Card>
    </main>
  );
}
