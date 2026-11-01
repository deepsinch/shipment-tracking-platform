/**
 * `pnpm intake:eval` — runs the AI intake fixtures against the LIVE model and prints field-level
 * accuracy. Not part of CI or the test suite (those use recorded answers and never call the API);
 * run it by hand when you change the prompt, the schema or the model.
 *
 * Needs ANTHROPIC_API_KEY (from the environment or .env). INTAKE_MODEL overrides the model id.
 * It sends the committed, invented fixture emails (src/server/intake/fixtures.ts) and costs a few
 * cents at most: eight short emails, small answers. Each answer goes through the same checks as
 * in the app (`buildDraft`) and is compared with the fixture's expected form values.
 *
 * Runs with `tsx --conditions=react-server` so the `server-only` imports resolve.
 */
import { config as loadEnv } from "dotenv";

import { INTAKE_FIELD_LABELS, INTAKE_FIELDS, type IntakeField } from "@/domain/intake";
import { createAnthropicIntakeModel, DEFAULT_INTAKE_MODEL } from "@/server/intake/anthropic-model";
import { buildDraft } from "@/server/intake/draft";
import { INTAKE_FIXTURES } from "@/server/intake/fixtures";

loadEnv({ quiet: true });

/** Fixed, so relative dates in the fixtures resolve the same way on every run. */
const TODAY = "2026-11-02";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add it to .env or the environment to run the live eval.",
    );
    process.exitCode = 1;
    return;
  }
  const modelId = process.env.INTAKE_MODEL?.trim() || DEFAULT_INTAKE_MODEL;
  const model = createAnthropicIntakeModel({ apiKey, model: modelId });
  console.log(`Model: ${modelId}   fixtures: ${INTAKE_FIXTURES.length}   today: ${TODAY}\n`);

  const perField = new Map<IntakeField, { correct: number; total: number }>(
    INTAKE_FIELDS.map((field) => [field, { correct: 0, total: 0 }]),
  );
  const failures: string[] = [];
  let failedCalls = 0;

  for (const fixture of INTAKE_FIXTURES) {
    let draftValues: Record<IntakeField, string> | null = null;
    try {
      const raw = await model.extract({ emailText: fixture.email, today: TODAY });
      draftValues = buildDraft(raw, fixture.email).values;
    } catch {
      failedCalls += 1;
      console.log(`${fixture.id.padEnd(30)} the model call failed`);
    }

    let correct = 0;
    for (const field of INTAKE_FIELDS) {
      const expected = fixture.expected[field] ?? "";
      const actual = draftValues?.[field] ?? null;
      const stats = perField.get(field)!;
      stats.total += 1;
      if (actual === expected) {
        stats.correct += 1;
        correct += 1;
      } else if (actual !== null) {
        failures.push(
          `  ${fixture.id} / ${INTAKE_FIELD_LABELS[field]}: expected ${show(expected)}, got ${actual === null ? "no answer" : show(actual)}`,
        );
      }
    }
    if (draftValues) {
      console.log(
        `${fixture.id.padEnd(30)} ${correct}/${INTAKE_FIELDS.length} fields   ${fixture.covers}`,
      );
    }
  }

  console.log("\nField accuracy (blank is the expected answer when the email does not say)");
  console.log(`${"field".padEnd(24)} correct  accuracy`);
  let allCorrect = 0;
  let all = 0;
  for (const field of INTAKE_FIELDS) {
    const { correct, total } = perField.get(field)!;
    allCorrect += correct;
    all += total;
    console.log(
      `${INTAKE_FIELD_LABELS[field].padEnd(24)} ${`${correct}/${total}`.padEnd(8)} ${percent(correct, total)}`,
    );
  }
  console.log(
    `${"all fields".padEnd(24)} ${`${allCorrect}/${all}`.padEnd(8)} ${percent(allCorrect, all)}`,
  );
  if (failedCalls > 0) console.log(`\n${failedCalls} model call(s) failed.`);
  if (failures.length > 0) console.log(`\nMismatches:\n${failures.join("\n")}`);
}

const show = (value: string) => (value === "" ? "(blank)" : JSON.stringify(value));
const percent = (part: number, whole: number) => `${((part / whole) * 100).toFixed(0)}%`;

await main();
