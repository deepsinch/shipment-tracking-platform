import { describe, expect, it } from "vitest";

import { resolveAuthUrls } from "./base-url";

const VERCEL = {
  VERCEL: "1",
  VERCEL_PROJECT_PRODUCTION_URL: "waybill.vercel.app",
  VERCEL_BRANCH_URL: "waybill-git-feature-team.vercel.app",
  VERCEL_URL: "waybill-abc123-team.vercel.app",
};

describe("resolveAuthUrls", () => {
  describe("outside Vercel", () => {
    it("uses BETTER_AUTH_URL", () => {
      expect(resolveAuthUrls({ BETTER_AUTH_URL: "http://localhost:3000" })).toEqual({
        ok: true,
        url: "http://localhost:3000",
        trustedOrigins: ["http://localhost:3000"],
      });
    });

    it("requires BETTER_AUTH_URL, saying it is only derived on Vercel", () => {
      const result = resolveAuthUrls({});
      expect(result).toMatchObject({ ok: false });
      expect(!result.ok && result.message).toContain("only derived automatically on Vercel");
    });

    it("treats a blank BETTER_AUTH_URL as unset", () => {
      expect(resolveAuthUrls({ BETTER_AUTH_URL: "  " })).toMatchObject({ ok: false });
    });

    it("ignores Vercel hosts when not on Vercel", () => {
      const hosts = { ...VERCEL, VERCEL: undefined };
      expect(resolveAuthUrls({ BETTER_AUTH_URL: "http://localhost:3000", ...hosts })).toMatchObject(
        { trustedOrigins: ["http://localhost:3000"] },
      );
    });

    it("drops a trailing slash", () => {
      expect(resolveAuthUrls({ BETTER_AUTH_URL: "http://localhost:3000/" })).toMatchObject({
        url: "http://localhost:3000",
      });
    });
  });

  describe("on Vercel", () => {
    it("derives the production URL from the project's production domain", () => {
      expect(resolveAuthUrls({ ...VERCEL, VERCEL_ENV: "production" })).toEqual({
        ok: true,
        url: "https://waybill.vercel.app",
        trustedOrigins: [
          "https://waybill.vercel.app",
          "https://waybill-git-feature-team.vercel.app",
          "https://waybill-abc123-team.vercel.app",
        ],
      });
    });

    it("derives a preview's URL from the branch URL", () => {
      expect(resolveAuthUrls({ ...VERCEL, VERCEL_ENV: "preview" })).toMatchObject({
        ok: true,
        url: "https://waybill-git-feature-team.vercel.app",
      });
    });

    it("falls back to the deployment URL when a preview has no branch URL", () => {
      expect(
        resolveAuthUrls({ ...VERCEL, VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "" }),
      ).toMatchObject({ ok: true, url: "https://waybill-abc123-team.vercel.app" });
    });

    it("falls back to the deployment URL when production has no production domain", () => {
      expect(
        resolveAuthUrls({
          ...VERCEL,
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: undefined,
        }),
      ).toMatchObject({ ok: true, url: "https://waybill-abc123-team.vercel.app" });
    });

    it("lets BETTER_AUTH_URL win (a custom domain), still trusting Vercel's own hosts", () => {
      expect(
        resolveAuthUrls({
          ...VERCEL,
          VERCEL_ENV: "production",
          BETTER_AUTH_URL: "https://waybill.example",
        }),
      ).toEqual({
        ok: true,
        url: "https://waybill.example",
        trustedOrigins: [
          "https://waybill.example",
          "https://waybill.vercel.app",
          "https://waybill-git-feature-team.vercel.app",
          "https://waybill-abc123-team.vercel.app",
        ],
      });
    });

    it("never trusts the same origin twice", () => {
      const result = resolveAuthUrls({
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "waybill.vercel.app",
        VERCEL_URL: "waybill.vercel.app",
      });
      expect(result).toMatchObject({ trustedOrigins: ["https://waybill.vercel.app"] });
    });

    it("accepts hosts that include a scheme", () => {
      expect(
        resolveAuthUrls({
          VERCEL_ENV: "production",
          VERCEL_PROJECT_PRODUCTION_URL: "https://waybill.vercel.app/",
        }),
      ).toMatchObject({ url: "https://waybill.vercel.app" });
    });

    it("needs BETTER_AUTH_URL under `vercel dev`, where nothing can be derived", () => {
      const result = resolveAuthUrls({ VERCEL: "1", VERCEL_ENV: "development" });
      expect(result).toMatchObject({ ok: false });
      expect(!result.ok && result.message).toContain("on Vercel it is derived");
    });

    it("fails when the host variables are missing too", () => {
      expect(resolveAuthUrls({ VERCEL: "1", VERCEL_ENV: "preview" })).toMatchObject({ ok: false });
    });
  });
});
