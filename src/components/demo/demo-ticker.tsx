"use client";

import { useEffect } from "react";

import { DEMO_TICK_INTERVAL_MS, DEMO_TICK_PATH } from "@/domain/demo";
import { createDemoTicker } from "@/lib/demo-ticker";

/**
 * Moves the hosted demo's trucks while this page is open: asks `/api/demo/tick` for one simulator
 * tick every ~12 s (see `createDemoTicker` for the pacing, the pause in a hidden tab and the
 * cleanup). The server throttles all viewers together, and the live updates already on the page
 * (`LiveRefresh`, the map's position stream) show what moved. Renders nothing.
 */
export function DemoTicker() {
  useEffect(() => {
    const ticker = createDemoTicker({
      isHidden: () => document.hidden,
      intervalMs: DEMO_TICK_INTERVAL_MS,
      jitterMs: 3_000,
      tick: async (signal) => {
        const response = await fetch(DEMO_TICK_PATH, {
          method: "POST",
          cache: "no-store",
          signal,
        });
        // Read to the end so the connection is released (an unread body keeps the request open).
        await response.arrayBuffer();
        // Not signed in (401), not part of the demo (403) or demo mode off (404): retrying
        // cannot help. Anything else (a 5xx, a throttled 200) just waits for the next round.
        return response.status === 401 || response.status === 403 || response.status === 404
          ? "stop"
          : "continue";
      },
    });
    const onVisibilityChange = () => ticker.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibilityChange);
    ticker.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      ticker.stop();
    };
  }, []);

  return null;
}
