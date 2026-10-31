import { ListIcon, MapIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

const VIEWS = [
  { key: "list", href: "/dashboard/shipments", label: "List", Icon: ListIcon },
  { key: "map", href: "/dashboard/map", label: "Map", Icon: MapIcon },
] as const;

/**
 * Switches between the shipment list and the live map. Each view is its own URL, so either can be
 * bookmarked or shared, and the list never loads the map's code.
 */
export function ShipmentsViewNav({ current }: { current: (typeof VIEWS)[number]["key"] }) {
  return (
    <nav aria-label="Shipment views" className="inline-flex rounded-lg border bg-background p-0.5">
      {VIEWS.map(({ key, href, label, Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={key === current ? "page" : undefined}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            key === current && "bg-secondary text-foreground shadow-xs",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
