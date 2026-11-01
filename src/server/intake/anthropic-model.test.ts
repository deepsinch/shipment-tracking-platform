import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  class APIError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
      this.name = "APIError";
    }
  }
  const create = vi.fn();
  // The default export is a class whose instances have `messages.create`; APIError hangs off it.
  const Anthropic = Object.assign(
    vi.fn(function (this: { messages: { create: typeof create } }) {
      this.messages = { create };
    }),
    { APIError },
  );
  return { create, Anthropic, APIError };
});
vi.mock("@anthropic-ai/sdk", () => ({ default: sdk.Anthropic }));

import {
  INTAKE_MAX_OUTPUT_TOKENS,
  createAnthropicIntakeModel,
  DEFAULT_INTAKE_MODEL,
} from "./anthropic-model";
import { IntakeModelError } from "./model";

const EMAIL = "SECRET-EMAIL-BODY collect at Kade 4, Antwerpen";
const answer = (text: string, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text }],
});

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sdk.create.mockReset();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => errors.mockRestore());

describe("the Anthropic adapter", () => {
  it("sends the email once, in the user message, with a JSON schema and no tools", async () => {
    sdk.create.mockResolvedValue(answer('{"recipientName":"Ada"}'));
    const model = createAnthropicIntakeModel({ apiKey: "sk-ant-test" });

    const raw = await model.extract({ emailText: EMAIL, today: "2026-11-02" });

    expect(raw).toEqual({ recipientName: "Ada" });
    expect(sdk.Anthropic).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-ant-test" }));
    const request = sdk.create.mock.calls[0]![0];
    expect(request.model).toBe(DEFAULT_INTAKE_MODEL);
    expect(DEFAULT_INTAKE_MODEL).toBe("claude-haiku-5-5");
    expect(request.max_tokens).toBe(INTAKE_MAX_OUTPUT_TOKENS);
    expect(request.output_config.format.type).toBe("json_schema");
    expect(request.tools).toBeUndefined();
    expect(request.tool_choice).toBeUndefined();
    // Untrusted text only ever sits in the user message.
    expect(request.system).not.toContain("SECRET-EMAIL-BODY");
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].role).toBe("user");
    expect(request.messages[0].content).toContain(EMAIL);
  });

  it("uses the model id it was given", async () => {
    sdk.create.mockResolvedValue(answer("{}"));
    await createAnthropicIntakeModel({ apiKey: "k", model: "claude-test-1" }).extract({
      emailText: EMAIL,
      today: "2026-11-02",
    });
    expect(sdk.create.mock.calls[0]![0].model).toBe("claude-test-1");
  });

  it.each([
    ["a cut-off answer", answer('{"recipientName":"Ad', "max_tokens")],
    ["a refusal", answer("", "refusal")],
    ["no text", { stop_reason: "end_turn", content: [] }],
    ["text that is not JSON", answer("Sure! Here is the booking")],
  ])("fails with a fixed message for %s", async (_label, response) => {
    sdk.create.mockResolvedValue(response);
    const model = createAnthropicIntakeModel({ apiKey: "k" });
    await expect(model.extract({ emailText: EMAIL, today: "2026-11-02" })).rejects.toThrow(
      IntakeModelError,
    );
  });

  it("never logs the email, even when the SDK's error carries it", async () => {
    sdk.create.mockRejectedValue(new sdk.APIError(429, `rate limited: ${EMAIL}`));
    const model = createAnthropicIntakeModel({ apiKey: "k" });

    await expect(model.extract({ emailText: EMAIL, today: "2026-11-02" })).rejects.toThrow(
      IntakeModelError,
    );

    const logged = JSON.stringify(errors.mock.calls);
    expect(logged).not.toContain("SECRET-EMAIL-BODY");
    expect(logged).toContain("429");
  });
});
