import { SearchIcon } from "lucide-react";

import { trackShipmentAction } from "@/app/track/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Works without JavaScript: a plain form posting to a Server Action that redirects. */
export function TrackForm({ defaultValue }: { defaultValue?: string }) {
  return (
    <form action={trackShipmentAction} className="flex w-full flex-col gap-2">
      <Label htmlFor="tracking-code">Tracking code</Label>
      <div className="flex gap-2">
        <Input
          id="tracking-code"
          name="code"
          placeholder="WB-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          required
          defaultValue={defaultValue}
          className="h-10 font-mono uppercase placeholder:normal-case"
        />
        <Button type="submit" size="lg" className="h-10">
          <SearchIcon aria-hidden="true" />
          Track
        </Button>
      </div>
    </form>
  );
}
