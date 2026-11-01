"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Copies `value` to the clipboard. If the browser refuses (insecure context, permissions), the
 * text stays selectable next to the button and the button says so instead of failing silently.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {state === "copied" ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy manually" : label}
    </Button>
  );
}
