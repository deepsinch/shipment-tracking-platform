import { SiteHeader } from "@/components/site-header";

/** Public pages for customers: no account, no dashboard chrome. */
export default function TrackLayout({ children }: LayoutProps<"/track">) {
  return (
    <>
      <SiteHeader />
      <div className="flex flex-1 flex-col bg-muted/40">{children}</div>
    </>
  );
}
