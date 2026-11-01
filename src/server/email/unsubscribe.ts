import "server-only";

import {
  deriveUnsubscribeKey,
  signUnsubscribeToken,
  type UnsubscribeSubject,
} from "@/domain/unsubscribe-token";
import { env } from "@/server/env";

/** The public unsubscribe link for an address, on this deployment's own origin. */
export function unsubscribeUrlFor(subject: UnsubscribeSubject): string {
  const token = signUnsubscribeToken(deriveUnsubscribeKey(env.auth.secret), subject);
  return `${env.auth.url}/unsubscribe/${token}`;
}

/** The public tracking page link for a tracking code. */
export function trackingUrlFor(trackingCode: string): string {
  return `${env.auth.url}/track/${encodeURIComponent(trackingCode)}`;
}
