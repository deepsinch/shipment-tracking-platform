"use client";

import { useEffect, useState } from "react";

/**
 * The current time, re-read every `intervalMs`, for relative times such as "3 min ago". Null during
 * server rendering and hydration: the server's clock is not the viewer's, so relative text
 * rendered there would be stale or mismatch on hydration. Callers show an absolute time until then.
 */
export function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
