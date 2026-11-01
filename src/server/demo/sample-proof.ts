import {
  DEMO_SAMPLE_PHOTO_KEY,
  roundCoordinate,
  type DeliveryProofRecord,
  type Signature,
  type SignaturePoint,
} from "@/domain/delivery-proof";

/**
 * Proof of delivery for the demo's seeded and simulated deliveries, so the staff view has
 * something to show without any visitor's file or handwriting being stored. The signature is a
 * generated scribble (a looped curve and an underline, varied by `variant`), the photo is the
 * placeholder marker (`DEMO_SAMPLE_PHOTO_KEY`: nothing is stored under it), and the name is the
 * shipment's recipient. Deterministic, so reseeding gives the same pictures.
 */
export function sampleProof(recipientName: string, variant: number): DeliveryProofRecord {
  return {
    recipientName,
    // Every fourth delivery was signed for by name only, like a recipient who declined to sign.
    signature: variant % 4 === 3 ? null : sampleSignature(variant),
    // And every third has no photo, so the card shows each combination.
    photoKey: variant % 3 === 2 ? null : DEMO_SAMPLE_PHOTO_KEY,
  };
}

function sampleSignature(variant: number): Signature {
  const loops = 2 + (variant % 3);
  const curve: SignaturePoint[] = [];
  for (let step = 0; step <= 60; step += 1) {
    const t = step / 60;
    const x = 0.08 + 0.84 * t;
    const y = 0.5 + 0.28 * Math.sin(t * Math.PI * 2 * loops) * (1 - 0.5 * t);
    curve.push([roundCoordinate(x), roundCoordinate(y)]);
  }
  const underline: SignaturePoint[] = [
    [0.12, 0.84],
    [0.5, 0.8 + (variant % 2) * 0.03],
    [0.9, 0.84],
  ];
  return { aspect: 2.2, strokes: [curve, underline] };
}
