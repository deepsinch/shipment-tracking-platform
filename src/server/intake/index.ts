import "server-only";

import { env } from "@/server/env";

import { createAnthropicIntakeModel } from "./anthropic-model";
import { createFakeIntakeModel, type IntakeModel } from "./model";

export type { IntakeModel } from "./model";

/**
 * This deployment's intake model, or null when AI intake is off (no `ANTHROPIC_API_KEY`). The
 * recorded-answers fake (`INTAKE_USE_FAKE_MODEL`, tests and local runs only; env.ts refuses it on
 * Vercel and in demo mode) takes precedence, so a test run can never reach the live API even if a
 * real key is also set. The fixtures are loaded only for the fake.
 */
export async function getIntakeModel(): Promise<IntakeModel | null> {
  const { enabled, useFake, apiKey, model } = env.intake;
  if (!enabled) return null;
  if (useFake) {
    const { FIXTURE_RESPONSES } = await import("./fixtures");
    return createFakeIntakeModel(FIXTURE_RESPONSES);
  }
  return createAnthropicIntakeModel({ apiKey: apiKey!, model });
}
