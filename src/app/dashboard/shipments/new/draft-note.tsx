import { SparklesIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { INTAKE_FIELD_LABELS, INTAKE_FIELDS, type IntakeDraft } from "@/domain/intake";

/**
 * Shown above a prefilled form: it says this is a draft to check, and which fields the email did
 * not give or the assistant got wrong, so the blanks are expected rather than a surprise.
 */
export function DraftNote({ draft }: { draft: IntakeDraft }) {
  const list = (status: "not_found" | "invalid") =>
    INTAKE_FIELDS.filter((field) => draft.status[field] === status).map(
      (field) => INTAKE_FIELD_LABELS[field],
    );
  const filled = INTAKE_FIELDS.filter((field) => draft.status[field] === "found").length;
  const missing = list("not_found");
  const unusable = list("invalid");

  return (
    <Alert role="status" data-testid="draft-note">
      <SparklesIcon aria-hidden="true" />
      <AlertTitle>AI draft: check every field</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <p>
          {filled} {filled === 1 ? "field was" : "fields were"} filled in from the email. The
          assistant can misread an address or a weight, so compare the draft with the email before
          you create the shipment.
        </p>
        {missing.length > 0 && <p>Not found in the email, left blank: {missing.join(", ")}.</p>}
        {unusable.length > 0 && <p>Could not be used, left blank: {unusable.join(", ")}.</p>}
      </AlertDescription>
    </Alert>
  );
}
