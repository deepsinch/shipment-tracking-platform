import Anthropic from "@anthropic-ai/sdk";

import { IntakeModelError, type IntakeModel } from "./model";
import { buildIntakeUserMessage, INTAKE_SYSTEM_PROMPT } from "./prompt";
import { intakeJsonSchema } from "./schema";

/** Fast and cheap: reading one email into fourteen fields needs no more. Overridable (INTAKE_MODEL). */
export const DEFAULT_INTAKE_MODEL = "claude-haiku-5-5";

/** The answer is a small JSON object; this is generous for it and a hard cap on spend per call. */
export const INTAKE_MAX_OUTPUT_TOKENS = 1500;

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Anthropic Messages API with structured outputs (`output_config.format`, a JSON schema): the
 * response is a JSON object of the shape in `schema.ts`. No tools are offered, so there is nothing
 * for an injected instruction to invoke. Effort is `low`: this is reading, not reasoning.
 *
 * Failures (network, timeout, rate limit, a refusal, a cut-off answer, text that is not JSON) become
 * an `IntakeModelError` with a fixed message. The email is never logged, and SDK errors are
 * reduced to their class and status before they leave this file, because some carry request bodies.
 *
 * Written against @anthropic-ai/sdk 1.3 (`messages.create`, `output_config`). Not exercised against
 * the live API from CI or the build environment: `pnpm intake:eval` does that on demand.
 */
export function createAnthropicIntakeModel(options: {
  apiKey: string;
  model?: string;
}): IntakeModel {
  const model = options.model ?? DEFAULT_INTAKE_MODEL;
  const client = new Anthropic({
    apiKey: options.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  });

  return {
    name: model,
    async extract({ emailText, today }) {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: INTAKE_MAX_OUTPUT_TOKENS,
          system: INTAKE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildIntakeUserMessage(emailText, today) }],
          output_config: {
            effort: "low",
            format: { type: "json_schema", schema: intakeJsonSchema() },
          },
        });
      } catch (error) {
        const status = error instanceof Anthropic.APIError ? error.status : undefined;
        console.error("Intake model request failed", {
          type: error instanceof Error ? error.name : typeof error,
          status,
        });
        throw new IntakeModelError("The model request failed.");
      }

      if (response.stop_reason !== "end_turn") {
        console.error("Intake model stopped early", { stopReason: response.stop_reason });
        throw new IntakeModelError("The model did not finish its answer.");
      }
      const text = response.content.find((block) => block.type === "text");
      if (!text || text.type !== "text") throw new IntakeModelError("The model returned no text.");
      try {
        return JSON.parse(text.text) as unknown;
      } catch {
        throw new IntakeModelError("The model's answer was not JSON.");
      }
    },
  };
}
