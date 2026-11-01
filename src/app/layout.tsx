import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";

import { DemoBanner } from "@/components/demo/demo-banner";
import { DemoOnly } from "@/components/demo/demo-only";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Waybill",
    template: "%s | Waybill",
  },
  description: "Shipment tracking and dispatch for small carriers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {/* Demo deployments only; read at request time, so the rest keeps its static shell. */}
        <Suspense fallback={null}>
          <DemoOnly>
            <DemoBanner />
          </DemoOnly>
        </Suspense>
        {children}
      </body>
    </html>
  );
}
