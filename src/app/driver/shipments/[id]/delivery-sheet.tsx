"use client";

import { CameraIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";
import Image from "next/image";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import type { DeliveryFormState } from "@/app/_actions/deliver-shipment";
import { ActionMessage } from "@/components/action-message";
import { SignaturePad } from "@/components/delivery/signature-pad";
import { TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { resizePhoto, type ResizedPhoto } from "@/lib/photo-resize";

type Props = {
  open: boolean;
  onClose: () => void;
  shipmentId: string;
  trackingCode: string;
  recipientName: string;
  /**
   * The version the driver saw when they tapped "Mark as delivered". Pinned for the life of the
   * sheet, so a live refresh behind it cannot quietly turn this into a delivery of a changed
   * shipment: if someone else changed it, the delivery reports a conflict.
   */
  version: number;
  /** The note typed on the page behind the sheet, sent with the delivery. */
  publicNote: string;
  /** Photo capture exists only with storage configured and never in demo mode. */
  photosEnabled: boolean;
  state: DeliveryFormState;
  action: (formData: FormData) => void;
};

/**
 * The delivery sheet: what a driver does at the door. The recipient's printed name (required, the
 * proof every delivery has), an optional signature drawn on a pad and an optional photo, then
 * "Confirm delivery". It replaces the plain "are you sure?" step for deliveries in the driver app.
 *
 * Full screen on a phone (the pad needs the room, and a keyboard should not cover half of a small
 * dialog), a centred card on larger screens. Closing it throws away what was entered, so tapping
 * outside does not close it; Escape and "Cancel" do, on purpose.
 */
export function DeliverySheet({ open, ...props }: Props) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[90dvh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:ring-1 sm:ring-foreground/10"
          // Typing the name moves nothing: start there.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("field-recipientName")?.focus();
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <SheetBody {...props} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SheetBody({
  onClose,
  shipmentId,
  trackingCode,
  recipientName,
  version,
  publicNote,
  photosEnabled,
  state,
  action,
}: Omit<Props, "open">) {
  // Errors from an earlier attempt belong to an earlier sheet.
  const [attempted, setAttempted] = useState(false);
  const [photo, setPhoto] = useState<ResizedPhoto | null>(null);
  const shown = attempted ? state : {};

  function submit(formData: FormData) {
    setAttempted(true);
    // Not a form field: the photo was shrunk in the browser and lives here, which also keeps it
    // across a failed attempt (a form reset would empty a file input).
    if (photo) formData.set("photo", photo.blob, "delivery.jpg");
    action(formData);
  }

  return (
    <form
      action={submit}
      noValidate
      // The page behind the sheet should not change under a driver who is mid-handover.
      data-unsaved-guard
      className="flex min-h-0 flex-1 flex-col"
    >
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="publicNote" value={publicNote} />

      <header className="flex flex-col gap-1 border-b px-4 py-4">
        <DialogPrimitive.Title className="text-lg font-semibold">
          Deliver {trackingCode}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="text-sm text-muted-foreground">
          Ask the recipient to print their name. They can also sign. This cannot be undone.
        </DialogPrimitive.Description>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <ActionMessage state={shown} />
        <TextField
          name="recipientName"
          label="Recipient's printed name"
          description={`The shipment is addressed to ${recipientName}. Enter whoever actually received it.`}
          autoComplete="off"
          autoCapitalize="words"
          aria-required="true"
          defaultValue={shown.values?.recipientName}
          errors={shown.fieldErrors?.recipientName}
        />
        <SignaturePad
          name="signature"
          label="Signature (optional)"
          description="Draw with a finger, a stylus or a mouse. The printed name above is what counts, so a delivery without a signature is fine."
          error={shown.fieldErrors?.signature?.[0]}
        />
        {photosEnabled && (
          <PhotoField photo={photo} onChange={setPhoto} error={shown.fieldErrors?.photo?.[0]} />
        )}
        {publicNote && (
          <p className="text-sm text-muted-foreground">
            Note for the customer: <span className="text-foreground">{publicNote}</span>
          </p>
        )}
      </div>

      <footer className="flex flex-col-reverse gap-2 border-t bg-muted/50 px-4 py-4 sm:flex-row sm:justify-end sm:rounded-b-xl">
        <CancelButton onClose={onClose} />
        <ConfirmButton />
      </footer>
    </form>
  );
}

function CancelButton({ onClose }: { onClose: () => void }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="button"
      variant="outline"
      className="h-12 text-base sm:h-10 sm:text-sm"
      disabled={pending}
      onClick={onClose}
    >
      Not yet
    </Button>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="h-12 text-base sm:h-10 sm:text-sm">
      {pending ? (
        <>
          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          Delivering…
        </>
      ) : (
        "Confirm delivery"
      )}
    </Button>
  );
}

type PhotoFieldProps = {
  photo: ResizedPhoto | null;
  onChange: (photo: ResizedPhoto | null) => void;
  error?: string;
};

/**
 * Take (or choose) a photo, shrunk in the browser; a preview and "Remove photo" once there is one.
 * The camera opens directly on phones (`capture`). Optional, like the signature.
 */
function PhotoField({ photo, onChange, error }: PhotoFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    const resized = await resizePhoto(file);
    setBusy(false);
    if (resized) onChange(resized);
    else setProblem("That photo could not be read. Try taking it again.");
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm leading-snug font-medium">Photo (optional)</span>
      {photo && (
        <Image
          unoptimized
          src={photo.previewUrl}
          alt="The photo you took of the delivery"
          width={480}
          height={360}
          className="h-auto max-h-56 w-full rounded-md border object-contain"
        />
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="photo-input"
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          // The same file can be chosen again after removing it.
          event.target.value = "";
        }}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 flex-1 text-base sm:h-9 sm:flex-none sm:text-sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          ) : (
            <CameraIcon aria-hidden="true" />
          )}
          {photo ? "Retake photo" : "Take a photo"}
        </Button>
        {photo && (
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 text-base sm:h-9 sm:flex-none sm:text-sm"
            onClick={() => onChange(null)}
          >
            <Trash2Icon aria-hidden="true" />
            Remove photo
          </Button>
        )}
      </div>
      {(problem ?? error) && <p className="text-sm text-destructive">{problem ?? error}</p>}
    </div>
  );
}
