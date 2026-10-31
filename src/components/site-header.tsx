import { PackageIcon } from "lucide-react";
import Link from "next/link";

/** Brand mark linking home, plus optional actions on the right. */
export function SiteHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <PackageIcon className="size-5" aria-hidden="true" />
          Waybill
        </Link>
        {children && <div className="flex items-center gap-2 text-sm">{children}</div>}
      </div>
    </header>
  );
}
