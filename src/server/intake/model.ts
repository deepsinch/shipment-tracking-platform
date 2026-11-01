import { INTAKE_FIELDS } from "@/domain/intake";

/**
 * The language model behind AI intake, as a small interface: given an email, return the model's
 * raw extraction (unvalidated JSON). Implementations are the Anthropic adapter, and a fake that
 * replays recorded responses for tests, CI and the e2e server. Nothing here knows about shipments:
 * turning the raw answer into a checked draft is `buildDraft`, which treats it as untrusted.
 */
export interface IntakeModel {
  /** For logs and the eval table; never contains email text. */
  readonly name: string;
  extract(input: IntakeModelInput): Promise<unknown>;
}

export type IntakeModelInput = {
  /** The pasted email, untrusted. */
  emailText: string;
  /** Today in UTC (`YYYY-MM-DD`), so "next Friday" has something to be relative to. */
  today: string;
};

/** The model could not answer (network, timeout, refusal, cut off, not JSON). Carries no email text. */
export class IntakeModelError extends Error {
  override name = "IntakeModelError";
}

/** Whitespace-insensitive key of an email, for the fake's lookup. */
export function fixtureKey(emailText: string): string {
  return emailText.replace(/\s+/g, " ").trim();
}

/**
 * Replays recorded answers by email text. An email without a recording is an error, so a test or a
 * demo can never silently reach a live model by accident.
 */
export function createFakeIntakeModel(
  responses: ReadonlyMap<string, unknown> | Record<string, unknown>,
): IntakeModel {
  const byKey = new Map<string, unknown>(
    (responses instanceof Map ? [...responses] : Object.entries(responses)).map(
      ([text, answer]) => [fixtureKey(text), answer],
    ),
  );
  return {
    name: "fake",
    async extract({ emailText }) {
      const key = fixtureKey(emailText);
      if (!byKey.has(key))
        throw new IntakeModelError("The fake model has no recording for this email.");
      return structuredClone(byKey.get(key));
    },
  };
}

/** Field names the model may fill: the only keys of its answer that are ever read. */
export const MODEL_FIELDS = INTAKE_FIELDS;
