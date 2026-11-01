"use client";

import { MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Dialog } from "radix-ui";

import { Button } from "@/components/ui/button";

export type NavItem = { href: string; label: string };

/** True when `pathname` is the item's page or below it (the list's detail pages keep it current). */
function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The dashboard's navigation. From `sm` up it is a row of links in the header. Below that, a
 * menu button opens a side sheet (a Radix dialog: focus moves into it and is trapped, Escape and
 * the close button dismiss it, focus returns to the button). Both mark the current page with
 * `aria-current="page"`. Which links appear is decided on the server, by role.
 */
export function DashboardNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <nav aria-label="Dashboard" className="hidden sm:block">
        {items.map((item) => (
          <Button
            key={item.href}
            asChild
            variant="ghost"
            className={isCurrent(pathname, item.href) ? "bg-muted font-semibold" : undefined}
          >
            <Link
              href={item.href}
              aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          </Button>
        ))}
      </nav>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button variant="outline" size="icon" className="sm:hidden" aria-label="Menu">
            <MenuIcon aria-hidden="true" />
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col gap-4 border-l bg-background p-4 shadow-lg"
          >
            <div className="flex items-center justify-between">
              <Dialog.Title className="font-semibold">Menu</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close menu">
                  <XIcon aria-hidden="true" />
                </Button>
              </Dialog.Close>
            </div>
            <nav aria-label="Dashboard menu" className="flex flex-col gap-1">
              {items.map((item) => (
                <Button
                  key={item.href}
                  asChild
                  variant="ghost"
                  className={`justify-start ${isCurrent(pathname, item.href) ? "bg-muted font-semibold" : ""}`}
                >
                  <Link
                    href={item.href}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                </Button>
              ))}
            </nav>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
