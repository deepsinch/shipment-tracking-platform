import { describe, expect, it } from "vitest";

import { checkWebhookUrl, ipLiteralOf, isLocalHostname, isLoopbackHost } from "./webhook-url";

const PUBLIC = { allowLocalTargets: false };
const LOCAL = { allowLocalTargets: true };

describe("checkWebhookUrl", () => {
  it("accepts an https URL and normalizes it", () => {
    const result = checkWebhookUrl("  https://Hooks.Example.com:8443/in?x=1  ", PUBLIC);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.url.toString()).toBe("https://hooks.example.com:8443/in?x=1");
  });

  it.each([
    ["", /Enter the URL/],
    ["not a url", /full URL/],
    ["hooks.example.com/in", /full URL/],
    ["http://hooks.example.com/in", /https/],
    ["ftp://hooks.example.com/in", /https/],
    ["javascript:alert(1)", /https/],
    ["https://user:pw@hooks.example.com/", /username and password/],
    ["https://localhost/in", /public host name/],
    ["https://app.localhost/in", /public host name/],
    ["https://printer.local/in", /public host name/],
    ["https://metadata.internal/in", /public host name/],
    ["https://intranet/in", /public host name/],
    ["https://127.0.0.1/in", /loopback/],
    ["https://[::1]/in", /loopback/],
    ["https://10.0.0.5/in", /private/],
    ["https://169.254.169.254/latest/meta-data", /metadata/],
    ["https://[fd00:ec2::254]/", /metadata/],
    ["https://[::ffff:127.0.0.1]/", /loopback/],
    ["https://100.64.0.1/", /shared/],
    // The URL parser turns these spellings of 127.0.0.1 into the dotted form.
    ["https://2130706433/", /loopback/],
    ["https://0x7f.1/", /loopback/],
    ["https://0177.0.0.1/", /loopback/],
  ])("refuses %j", (text, message) => {
    const result = checkWebhookUrl(text, PUBLIC);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(message);
  });

  it("refuses an over-long URL", () => {
    expect(checkWebhookUrl(`https://example.com/${"a".repeat(2000)}`, PUBLIC).ok).toBe(false);
  });

  describe("with local targets allowed (development and tests)", () => {
    it.each([
      "http://localhost:4000/hook",
      "https://localhost/hook",
      "http://127.0.0.1:4000/hook",
      "http://[::1]:4000/hook",
      "http://sub.localhost:4000/hook",
    ])("accepts %s", (text) => expect(checkWebhookUrl(text, LOCAL).ok).toBe(true));

    it.each([
      "http://example.com/hook", // plain http stays for loopback only
      "http://10.0.0.5/hook",
      "https://10.0.0.5/hook",
      "http://169.254.169.254/latest",
      "https://192.168.1.1/",
      "https://printer.local/",
    ])("still refuses %s", (text) => expect(checkWebhookUrl(text, LOCAL).ok).toBe(false));
  });
});

describe("host helpers", () => {
  it("finds IP literals, with IPv6 brackets", () => {
    expect(ipLiteralOf("10.0.0.1")).toBe("10.0.0.1");
    expect(ipLiteralOf("[::1]")).toBe("::1");
    expect(ipLiteralOf("example.com")).toBeNull();
  });

  it("knows local names", () => {
    expect(isLocalHostname("localhost")).toBe(true);
    expect(isLocalHostname("LOCALHOST.")).toBe(true);
    expect(isLocalHostname("db")).toBe(true);
    expect(isLocalHostname("example.com")).toBe(false);
  });

  it("knows loopback hosts", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.2")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("10.0.0.1")).toBe(false);
    expect(isLoopbackHost("printer.local")).toBe(false);
  });
});
