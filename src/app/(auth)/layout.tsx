import { SiteHeader } from "@/components/site-header";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 items-start justify-center bg-muted/40 px-4 py-12 sm:py-20">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </>
  );
}
