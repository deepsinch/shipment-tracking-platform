import { ClockIcon, ShieldCheckIcon, TruckIcon } from "lucide-react";
import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { TrackForm } from "@/components/track-form";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: TruckIcon,
    title: "Dispatch in one place",
    text: "Create shipments, assign drivers and move them through a clear status flow.",
  },
  {
    icon: ClockIcon,
    title: "A trustworthy history",
    text: "Every status change is recorded and can never be edited after the fact.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Private by default",
    text: "Customers see the status and timeline, never addresses, notes or staff details.",
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader>
        <Button asChild variant="ghost">
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild>
          <Link href="/sign-up">Get started</Link>
        </Button>
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4">
        <section className="flex flex-col items-center gap-6 py-20 text-center sm:py-28">
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Shipment tracking and dispatch for small carriers
          </h1>
          <p className="max-w-xl text-lg text-balance text-muted-foreground">
            Waybill keeps dispatchers, drivers and customers on the same page, from pickup to
            delivery.
          </p>
          <div className="w-full max-w-md rounded-xl border bg-card p-4 text-left shadow-sm">
            <TrackForm />
          </div>
        </section>
        <section aria-label="Features" className="grid gap-6 pb-20 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex flex-col gap-2">
              <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
              <h2 className="font-medium">{title}</h2>
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
