import { SiteHeader } from "@/components/site-header";

/** Public page for customers, reached from an email link: no account, no dashboard chrome. */
export default function UnsubscribeLayout({ children }: LayoutProps<"/unsubscribe">) {
  return (
    <>
      <SiteHeader />
      <div className="flex flex-1 flex-col bg-muted/40">{children}</div>
    </>
  );
}
