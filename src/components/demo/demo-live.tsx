import { Suspense } from "react";

import { DemoOnly } from "./demo-only";
import { DemoTicker } from "./demo-ticker";

/** Put on a page that should keep the demo's trucks moving while it is open (demo mode only). */
export function DemoLive() {
  return (
    <Suspense fallback={null}>
      <DemoOnly>
        <DemoTicker />
      </DemoOnly>
    </Suspense>
  );
}
