import { shipmentStatusLabel, type ShipmentStatus } from "@/domain/shipment-status";

/**
 * The customer's status email, as plain text and simple HTML. Pure: everything it needs is passed
 * in, so the whole message is unit tested, and the stored copy is exactly what is sent.
 *
 * Only public information goes in: the status, the places, the tracking code and link, and the
 * public note of the event. Internal notes are not an input of this function at all, so no caller
 * can leak one by accident. The HTML is built by string templates with every value escaped
 * (`escapeHtml`), on the server; nothing here is ever rendered through React or
 * `dangerouslySetInnerHTML` (lint-banned).
 */

export type StatusEmailInput = {
  companyName: string;
  recipientName: string;
  status: ShipmentStatus;
  trackingCode: string;
  originCity: string;
  destinationCity: string;
  /** The event's public note, if any. */
  publicNote: string | null;
  trackingUrl: string;
  unsubscribeUrl: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Header values must not contain line breaks (header injection through a company name). */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const HEADLINES: Record<ShipmentStatus, string> = {
  created: "Your shipment has been booked",
  picked_up: "Your shipment has been picked up",
  in_transit: "Your shipment is on its way",
  out_for_delivery: "Your shipment is out for delivery",
  delivered: "Your shipment has been delivered",
  exception: "There is a problem with your shipment",
  cancelled: "Your shipment has been cancelled",
};

export function renderStatusEmail(input: StatusEmailInput): RenderedEmail {
  const headline = HEADLINES[input.status];
  const status = shipmentStatusLabel(input.status);
  const route = `${input.originCity} to ${input.destinationCity}`;
  const subject = singleLine(`${headline} (${input.trackingCode})`);

  const text = [
    `Hello ${input.recipientName},`,
    "",
    `${headline}.`,
    "",
    `Status: ${status}`,
    `Tracking code: ${input.trackingCode}`,
    `Route: ${route}`,
    ...(input.publicNote ? [`Note from ${input.companyName}: ${input.publicNote}`] : []),
    "",
    `Follow your shipment: ${input.trackingUrl}`,
    "",
    `Sent by ${input.companyName} through Waybill.`,
    `Stop these emails: ${input.unsubscribeUrl}`,
    "",
  ].join("\n");

  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px;">
<tr><td>
<p style="margin:0 0 16px;">Hello ${e(input.recipientName)},</p>
<h1 style="margin:0 0 16px;font-size:20px;">${e(headline)}</h1>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:14px;">
<tr><td style="padding:2px 16px 2px 0;color:#52525b;">Status</td><td><strong>${e(status)}</strong></td></tr>
<tr><td style="padding:2px 16px 2px 0;color:#52525b;">Tracking code</td><td style="font-family:monospace;">${e(input.trackingCode)}</td></tr>
<tr><td style="padding:2px 16px 2px 0;color:#52525b;">Route</td><td>${e(route)}</td></tr>
</table>${
    input.publicNote
      ? `
<p style="margin:0 0 16px;padding:12px;background:#f4f4f5;border-radius:6px;font-size:14px;"><strong>Note from ${e(input.companyName)}:</strong> ${e(input.publicNote)}</p>`
      : ""
  }
<p style="margin:0 0 24px;"><a href="${e(input.trackingUrl)}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;">Follow your shipment</a></p>
<p style="margin:0;font-size:12px;color:#71717a;">Sent by ${e(input.companyName)} through Waybill.<br><a href="${e(input.unsubscribeUrl)}" style="color:#71717a;">Stop these emails</a></p>
</td></tr>
</table>
</body>
</html>
`;

  return { subject, text, html };
}
