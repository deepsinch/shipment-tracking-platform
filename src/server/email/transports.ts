import "server-only";

import { isPermanentEmailFailure, type EmailTransportName } from "@/domain/email";

/**
 * Where a rendered email goes. Two implementations behind one interface (decision 49): Resend for
 * real sending, and a preview that "sends" by doing nothing, because the message is already stored
 * in `email_messages` (that row is what staff read under Email previews). Tests use the Resend
 * adapter against a local fake server, so CI never calls the real API.
 */

export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Sent as Resend's `Idempotency-Key`: the same key sends at most one email within 24 hours. */
  idempotencyKey: string;
  headers?: Record<string, string>;
};

export type SendResult =
  | { kind: "sent"; providerMessageId: string | null }
  /** `permanent`: retrying cannot succeed (see `isPermanentEmailFailure`). */
  | { kind: "failed"; message: string; permanent?: boolean };

export interface EmailTransport {
  readonly name: EmailTransportName;
  send(email: OutgoingEmail): Promise<SendResult>;
}

export const previewTransport: EmailTransport = {
  name: "preview",
  // The stored message is the preview; there is nothing to hand over.
  send: async () => ({ kind: "sent", providerMessageId: null }),
};

export const RESEND_API_URL = "https://api.resend.com";
const SEND_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 300;

export type ResendOptions = {
  apiKey: string;
  /** Overridable so tests can point the adapter at a local fake. */
  baseUrl?: string;
  timeoutMs?: number;
};

/**
 * Resend's "Send Email" endpoint, `POST /emails`, with `Authorization: Bearer <key>` and an
 * `Idempotency-Key` header (https://resend.com/docs/api-reference/emails/send-email). Plain
 * `fetch` instead of the SDK: one endpoint, no dependency, and the request is easy to fake.
 * Redirects are not followed (the API never redirects; the key must not follow one anywhere).
 * The error text never includes the key.
 */
export function createResendTransport(options: ResendOptions): EmailTransport {
  const baseUrl = (options.baseUrl ?? RESEND_API_URL).replace(/\/$/, "");
  return {
    name: "resend",
    async send(email) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/emails`, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs ?? SEND_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": email.idempotencyKey,
          },
          body: JSON.stringify({
            from: email.from,
            to: [email.to],
            subject: email.subject,
            text: email.text,
            html: email.html,
            ...(email.headers ? { headers: email.headers } : {}),
          }),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        return {
          kind: "failed",
          message: timedOut ? "Resend did not answer in time" : "Could not reach Resend",
        };
      }

      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const id = (body as { id?: unknown } | null)?.id;
        return { kind: "sent", providerMessageId: typeof id === "string" ? id : null };
      }
      const detail = (body as { message?: unknown } | null)?.message;
      const text = `Resend answered ${response.status}${typeof detail === "string" ? `: ${detail}` : ""}`;
      return {
        kind: "failed",
        message: text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text,
        permanent: isPermanentEmailFailure(response.status),
      };
    },
  };
}
