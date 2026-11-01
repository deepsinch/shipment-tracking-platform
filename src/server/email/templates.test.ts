import { describe, expect, it } from "vitest";

import { SHIPMENT_STATUSES } from "@/domain/shipment-status";

import { escapeHtml, renderStatusEmail, type StatusEmailInput } from "./templates";

const input: StatusEmailInput = {
  companyName: "Demo Freight Co",
  recipientName: "Ada Recipient",
  status: "out_for_delivery",
  trackingCode: "WB-ABCD-1234",
  originCity: "Rotterdam",
  destinationCity: "Antwerp",
  publicNote: "Driver is 10 minutes away",
  trackingUrl: "https://waybill.example.com/track/WB-ABCD-1234",
  unsubscribeUrl: "https://waybill.example.com/unsubscribe/abc.def",
};

describe("renderStatusEmail", () => {
  it("names the status, code, route, public note, tracking link and unsubscribe link in both versions", () => {
    const { subject, text, html } = renderStatusEmail(input);
    expect(subject).toBe("Your shipment is out for delivery (WB-ABCD-1234)");
    for (const body of [text, html]) {
      for (const expected of [
        "Out for delivery",
        "WB-ABCD-1234",
        "Rotterdam to Antwerp",
        "Driver is 10 minutes away",
        input.trackingUrl,
        input.unsubscribeUrl,
        "Demo Freight Co",
      ]) {
        expect(body).toContain(expected);
      }
    }
  });

  it("omits the note line when there is no public note", () => {
    const { text, html } = renderStatusEmail({ ...input, publicNote: null });
    expect(text).not.toContain("Note from");
    expect(html).not.toContain("Note from");
  });

  it("escapes every value in the HTML, so a typed name or note cannot inject markup", () => {
    const hostile = '<img src=x onerror="alert(1)"> & "quotes" \'single\'';
    const { html, text } = renderStatusEmail({
      ...input,
      recipientName: hostile,
      publicNote: hostile,
      companyName: hostile,
      originCity: hostile,
      destinationCity: hostile,
      trackingUrl: 'https://x.example/"><script>alert(1)</script>',
    });
    expect(html).not.toMatch(/<img|<script|onerror="/);
    expect(html).toContain(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;quotes&quot; &#39;single&#39;",
    );
    // The plain-text version is text: it carries the characters as typed.
    expect(text).toContain(hostile);
  });

  it("keeps line breaks out of the subject", () => {
    const { subject } = renderStatusEmail({
      ...input,
      trackingCode: "WB-1\r\nBcc: evil@example.com",
    });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it("has a headline for every status", () => {
    for (const status of SHIPMENT_STATUSES) {
      expect(renderStatusEmail({ ...input, status }).subject).toMatch(/^Your shipment|^There is/);
    }
  });

  it("takes no internal note: the input type has no such field", () => {
    expect(Object.keys(input)).not.toContain("internalNote");
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
