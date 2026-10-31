import { CircleCheckIcon } from "lucide-react";

import { FormAlert } from "@/components/form-alert";
import { Alert, AlertTitle } from "@/components/ui/alert";

/** The outcome of a form action that stays on the page (status change, driver assignment). */
export type ActionOutcome = {
  outcome?: "updated" | "conflict" | "error";
  title?: string;
  message?: string;
};

/**
 * A confirmation (`role="status"`, `data-testid="form-status"`) or the form's one alert
 * (`data-testid="form-alert"`). Renders nothing before the first submission.
 */
export function ActionMessage({ state }: { state: ActionOutcome }) {
  if (state.outcome === "updated") {
    return (
      <Alert role="status" data-testid="form-status">
        <CircleCheckIcon aria-hidden="true" className="text-emerald-600" />
        <AlertTitle>{state.message}</AlertTitle>
      </Alert>
    );
  }
  if (state.outcome === "conflict" || state.outcome === "error") {
    return <FormAlert title={state.title}>{state.message}</FormAlert>;
  }
  return null;
}
