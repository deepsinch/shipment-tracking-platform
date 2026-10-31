import { CircleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** The one announced message for a failed form submission. */
export function FormAlert({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <Alert variant="destructive" data-testid="form-alert">
      <CircleAlertIcon aria-hidden="true" />
      {title && <AlertTitle>{title}</AlertTitle>}
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}
