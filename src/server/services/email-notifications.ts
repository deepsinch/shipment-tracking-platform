import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  canViewEmailPreviews,
  canViewEmailStatus,
  emailDisplayStatus,
  type EmailDisplayStatus,
} from "@/domain/email";
import { deriveUnsubscribeKey, verifyUnsubscribeToken } from "@/domain/unsubscribe-token";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { emailMessages, emailOptOuts, organization, shipments } from "@/server/db/schema";
import { env } from "@/server/env";

import { forbidden, notFound, type Forbidden, type NotFound } from "./results";
import { visibleShipments } from "./shipment-access";

/** One email as the staff shipment page shows it: when and how it went, never its content. */
export type ShipmentEmailSummary = {
  id: string;
  status: EmailDisplayStatus;
  createdAt: Date;
  /** Why it is not sent yet or failed. */
  lastError: string | null;
};

export type ShipmentEmailStatus = {
  /** The address customers are emailed at, or null when the shipment has none. */
  recipient: string | null;
  optedOut: boolean;
  messages: ShipmentEmailSummary[];
};

export type ShipmentEmailStatusResult = ({ ok: true } & ShipmentEmailStatus) | Forbidden | NotFound;

/**
 * Whether and how the shipment's customer was emailed. Admins and dispatchers; built on
 * `visibleShipments`, so a shipment outside the caller's organization is not found.
 */
export async function getShipmentEmailStatus(
  ctx: AuthContext,
  shipmentId: string,
): Promise<ShipmentEmailStatusResult> {
  if (!canViewEmailStatus(ctx.role)) return forbidden;
  if (!z.uuid().safeParse(shipmentId).success) return notFound;

  const db = getDb();
  const [shipment] = await db
    .select({ id: shipments.id, recipientEmail: shipments.recipientEmail })
    .from(shipments)
    .where(and(eq(shipments.id, shipmentId), visibleShipments(ctx)))
    .limit(1);
  if (!shipment) return notFound;

  const recipient = shipment.recipientEmail?.trim().toLowerCase() || null;
  const [optOut] = recipient
    ? await db
        .select({ email: emailOptOuts.email })
        .from(emailOptOuts)
        .where(
          and(
            eq(emailOptOuts.organizationId, ctx.organizationId),
            eq(emailOptOuts.email, recipient),
          ),
        )
        .limit(1)
    : [];
  const rows = await db
    .select({
      id: emailMessages.id,
      status: emailMessages.status,
      transport: emailMessages.transport,
      createdAt: emailMessages.createdAt,
      lastError: emailMessages.lastError,
    })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.shipmentId, shipment.id),
        eq(emailMessages.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id));

  return {
    ok: true,
    recipient,
    optedOut: Boolean(optOut),
    messages: rows.map((row) => ({
      id: row.id,
      status: emailDisplayStatus(row),
      createdAt: row.createdAt,
      lastError: row.lastError,
    })),
  };
}

export type EmailPreview = {
  id: string;
  recipient: string;
  subject: string;
  /** The plain-text version: shown as text, never as markup. */
  textBody: string;
  createdAt: Date;
  shipmentId: string;
  trackingCode: string;
};

export const EMAIL_PREVIEW_LIMIT = 50;

export type EmailPreviewsResult = { ok: true; previews: EmailPreview[] } | Forbidden;

/**
 * The messages the preview transport took, newest first. Admins only: they hold customers'
 * addresses and the text of what was sent.
 */
export async function listEmailPreviews(ctx: AuthContext): Promise<EmailPreviewsResult> {
  if (!canViewEmailPreviews(ctx.role)) return forbidden;
  const previews = await getDb()
    .select({
      id: emailMessages.id,
      recipient: emailMessages.recipient,
      subject: emailMessages.subject,
      textBody: emailMessages.textBody,
      createdAt: emailMessages.createdAt,
      shipmentId: emailMessages.shipmentId,
      trackingCode: shipments.trackingCode,
    })
    .from(emailMessages)
    .innerJoin(shipments, eq(shipments.id, emailMessages.shipmentId))
    .where(
      and(
        eq(emailMessages.organizationId, ctx.organizationId),
        eq(emailMessages.transport, "preview"),
      ),
    )
    .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id))
    .limit(EMAIL_PREVIEW_LIMIT);
  return { ok: true, previews };
}

/** "ada@example.com" as "a***@example.com": enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
}

export type UnsubscribeTarget = {
  organizationName: string;
  maskedEmail: string;
  optedOut: boolean;
};

/** What the public unsubscribe page shows for a token, or null when the token is not genuine. */
export async function describeUnsubscribeToken(token: string): Promise<UnsubscribeTarget | null> {
  const subject = verifyUnsubscribeToken(deriveUnsubscribeKey(env.auth.secret), token);
  if (!subject) return null;
  const db = getDb();
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, subject.organizationId))
    .limit(1);
  if (!org) return null;
  const [existing] = await db
    .select({ email: emailOptOuts.email })
    .from(emailOptOuts)
    .where(
      and(
        eq(emailOptOuts.organizationId, subject.organizationId),
        eq(emailOptOuts.email, subject.email),
      ),
    )
    .limit(1);
  return {
    organizationName: org.name,
    maskedEmail: maskEmail(subject.email),
    optedOut: Boolean(existing),
  };
}

export type UnsubscribeResult =
  { ok: true; target: UnsubscribeTarget } | { ok: false; reason: "invalid_token" };

/**
 * Records the opt-out a genuine token names. Idempotent. The signature is the only authority:
 * there is no session, and the address and organization come from the token, never from the
 * request. Messages already queued for the address are suppressed when they are about to be sent.
 */
export async function unsubscribeWithToken(
  token: string,
  now: Date = new Date(),
): Promise<UnsubscribeResult> {
  const subject = verifyUnsubscribeToken(deriveUnsubscribeKey(env.auth.secret), token);
  if (!subject) return { ok: false, reason: "invalid_token" };

  await getDb()
    .insert(emailOptOuts)
    .values({
      organizationId: subject.organizationId,
      email: subject.email.toLowerCase(),
      optedOutAt: now,
    })
    .onConflictDoNothing();
  const target = await describeUnsubscribeToken(token);
  return target ? { ok: true, target } : { ok: false, reason: "invalid_token" };
}
