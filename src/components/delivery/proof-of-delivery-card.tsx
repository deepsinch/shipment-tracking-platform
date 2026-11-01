import { CircleCheckIcon, ImageIcon } from "lucide-react";
import Image from "next/image";

import { SignatureView } from "@/components/delivery/signature-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { DeliveryProofView } from "@/server/services/delivery-proof";

/** The static placeholder shown for the demo's sample photos (nothing real is stored for them). */
const SAMPLE_PHOTO_SRC = "/demo/sample-delivery-photo.svg";

type Props = {
  proof: DeliveryProofView | null;
  shipmentId: string;
  /** Whether the viewer may open the stored photo (staff, not the driver who took it). */
  canViewPhoto: boolean;
  className?: string;
};

/**
 * The staff view of a delivery's proof: who received it, the signature drawn again from its
 * strokes, and the photo. A delivery marked by the office has no proof and says so rather than
 * showing an empty card. Times in UTC like everywhere.
 */
export function ProofOfDeliveryCard({ proof, shipmentId, canViewPhoto, className }: Props) {
  return (
    <Card className={className} data-testid="proof-of-delivery">
      <CardHeader>
        <CardTitle>
          <h2>Proof of delivery</h2>
        </CardTitle>
        {proof && (
          <CardDescription>
            Recorded by {proof.capturedByName} · {formatDateTime(proof.capturedAt)}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {proof ? (
          <>
            <dl className="flex flex-col gap-1 text-sm">
              <dt className="text-muted-foreground">Signed for by</dt>
              <dd className="flex items-center gap-2 text-base font-medium">
                <CircleCheckIcon className="size-4 text-emerald-600" aria-hidden="true" />
                {proof.recipientName}
              </dd>
            </dl>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm text-muted-foreground">Signature</h3>
              {proof.signature ? (
                <SignatureView signature={proof.signature} className="max-w-md" />
              ) : (
                <p className="text-sm">
                  The recipient did not sign. The printed name is the proof.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm text-muted-foreground">Photo</h3>
              <PhotoSection proof={proof} shipmentId={shipmentId} canViewPhoto={canViewPhoto} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No proof of delivery was recorded. The delivery was marked from the office, or before
            proof was captured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PhotoSection({
  proof,
  shipmentId,
  canViewPhoto,
}: {
  proof: DeliveryProofView;
  shipmentId: string;
  canViewPhoto: boolean;
}) {
  if (proof.photo === "none") return <p className="text-sm">No photo was taken.</p>;
  if (proof.photo === "sample") {
    return (
      <figure className="flex max-w-md flex-col gap-1">
        <Image
          unoptimized
          src={SAMPLE_PHOTO_SRC}
          alt="A sample delivery photo: a parcel on a doorstep"
          width={480}
          height={320}
          className="h-auto w-full rounded-md border"
        />
        <figcaption className="text-xs text-muted-foreground">
          Sample photo. The public demo never stores photos.
        </figcaption>
      </figure>
    );
  }
  if (!canViewPhoto) {
    return (
      <p className="flex items-center gap-2 text-sm">
        <ImageIcon className="size-4" aria-hidden="true" />A photo was taken. Staff can see it on
        the dashboard.
      </p>
    );
  }
  return (
    <Image
      unoptimized
      src={`/dashboard/shipments/${shipmentId}/proof-photo`}
      alt="Photo taken at the delivery"
      width={800}
      height={600}
      className="h-auto max-h-96 w-full max-w-md rounded-md border object-contain"
    />
  );
}
