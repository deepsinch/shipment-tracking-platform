import { connection } from "next/server";

import { env } from "@/server/env";

/**
 * Renders `children` only on a demo deployment (`DEMO_MODE=true`). Reads the variable at request
 * time (`connection()`), so one build serves either mode and the rest of the page keeps its static
 * shell; the demo parts stream in. Always render it inside `<Suspense fallback={null}>`: without
 * demo mode nothing appears, and nothing is reserved for it.
 */
export async function DemoOnly({ children }: { children: React.ReactNode }) {
  await connection();
  return env.demo.enabled ? children : null;
}
