import { describe, expect, it } from "vitest";

import {
  canViewEmailPreviews,
  canViewEmailStatus,
  emailDisplayStatus,
  EMAIL_MESSAGE_STATUSES,
  EMAIL_NOTIFY_STATUSES,
  selectEmailTransport,
  shouldEmailForStatus,
} from "./email";
import { SHIPMENT_STATUSES } from "./shipment-status";

describe("shouldEmailForStatus", () => {
  it("notifies on the four chosen statuses only", () => {
    expect(SHIPMENT_STATUSES.filter(shouldEmailForStatus)).toEqual(
      SHIPMENT_STATUSES.filter((s) => (EMAIL_NOTIFY_STATUSES as readonly string[]).includes(s)),
    );
    expect([...EMAIL_NOTIFY_STATUSES].sort()).toEqual([
      "delivered",
      "exception",
      "out_for_delivery",
      "picked_up",
    ]);
    for (const quiet of ["created", "in_transit", "cancelled"] as const) {
      expect(shouldEmailForStatus(quiet)).toBe(false);
    }
  });
});

describe("selectEmailTransport", () => {
  const live = { resendApiKey: "re_123", from: "Waybill <hi@example.com>" };

  it("uses Resend only with a key and a sender, outside demo mode", () => {
    expect(selectEmailTransport({ demoMode: false, ...live })).toBe("resend");
    expect(selectEmailTransport({ demoMode: false, resendApiKey: "re_123", from: undefined })).toBe(
      "preview",
    );
    expect(
      selectEmailTransport({ demoMode: false, resendApiKey: undefined, from: live.from }),
    ).toBe("preview");
    expect(
      selectEmailTransport({ demoMode: false, resendApiKey: undefined, from: undefined }),
    ).toBe("preview");
  });

  it("always previews in demo mode, whatever is configured", () => {
    expect(selectEmailTransport({ demoMode: true, ...live })).toBe("preview");
    expect(selectEmailTransport({ demoMode: true, resendApiKey: undefined, from: undefined })).toBe(
      "preview",
    );
  });
});

describe("emailDisplayStatus", () => {
  it("maps every stored state to what staff read", () => {
    expect(
      EMAIL_MESSAGE_STATUSES.map((status) => emailDisplayStatus({ status, transport: null })),
    ).toEqual(["queued", "preview", "queued", "failed", "opted_out"]);
    expect(emailDisplayStatus({ status: "succeeded", transport: "resend" })).toBe("sent");
    expect(emailDisplayStatus({ status: "succeeded", transport: "preview" })).toBe("preview");
  });
});

describe("permissions", () => {
  it("staff see delivery status, only admins see message previews", () => {
    expect(
      ["admin", "dispatcher", "driver", "api"].map((r) => canViewEmailStatus(r as never)),
    ).toEqual([true, true, false, false]);
    expect(
      ["admin", "dispatcher", "driver", "api"].map((r) => canViewEmailPreviews(r as never)),
    ).toEqual([true, false, false, false]);
  });
});
