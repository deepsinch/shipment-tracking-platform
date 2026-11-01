import {
  SIGNATURE_VIEWBOX_WIDTH,
  signatureDescription,
  signaturePaths,
  type Signature,
} from "@/domain/delivery-proof";
import { cn } from "@/lib/utils";

/**
 * A stored signature drawn as SVG, from its strokes. Built from React elements with numeric path
 * data only (`signaturePaths`), so no markup is ever parsed from stored data. White paper with
 * dark ink in both themes, like the pad it was drawn on.
 */
export function SignatureView({
  signature,
  className,
}: {
  signature: Signature;
  className?: string;
}) {
  const { height, paths } = signaturePaths(signature);
  return (
    <svg
      role="img"
      aria-label={signatureDescription(signature)}
      viewBox={`0 0 ${SIGNATURE_VIEWBOX_WIDTH} ${height}`}
      className={cn("w-full rounded-md border bg-white", className)}
    >
      {paths.map((d, index) => (
        <path
          key={index}
          d={d}
          fill="none"
          stroke="#111111"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
