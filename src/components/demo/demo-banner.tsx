"use client";

import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { DEMO_RESET_LABEL } from "@/domain/demo";

const DISMISSED_KEY = "waybill:demo-banner-dismissed";

/**
 * A slim notice on every page of the hosted demo: it is a demo, and its data is wiped nightly.
 * Dismissed for the browser session (`sessionStorage`), not forever: a new visitor or a new tab
 * session sees it again. Storage can be unavailable (a private window, blocked site data); the
 * banner then simply stays until the page is left.
 */
export function DemoBanner() {
  // Unknown until mounted: the server cannot know whether this session dismissed it.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let stored = false;
    try {
      stored = window.sessionStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Storage unavailable: show the banner.
    }
    // Reading the browser-only store after mount: the server render cannot know it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(stored);
  }, []);

  if (dismissed !== false) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Dismissed for this page view only.
    }
  }

  return (
    <div
      role="region"
      aria-label="Demo notice"
      data-testid="demo-banner"
      className="border-b border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-1.5 text-sm">
        <p>
          <span className="font-semibold">Demo</span>
          <span aria-hidden="true"> · </span>
          data resets nightly around {DEMO_RESET_LABEL}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={dismiss}
          aria-label="Dismiss demo notice"
          className="-my-1 -mr-1.5 shrink-0 text-current hover:bg-amber-100 dark:hover:bg-amber-900"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
