"use client";

import { useActionState } from "react";

import { ActionMessage, type ActionOutcome } from "@/components/action-message";
import { Button } from "@/components/ui/button";

import { resendDeliveryAction } from "./actions";

/** Queues a finished delivery again (a new delivery of the same event). */
export function ResendButton({
  deliveryId,
  eventLabel,
}: {
  deliveryId: string;
  eventLabel: string;
}) {
  const [state, action, pending] = useActionState<ActionOutcome, FormData>(
    resendDeliveryAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        Resend<span className="sr-only"> {eventLabel}</span>
      </Button>
      {state.outcome && <ActionMessage state={state} />}
    </form>
  );
}
