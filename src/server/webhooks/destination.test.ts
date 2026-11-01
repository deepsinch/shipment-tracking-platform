import { describe, expect, it, vi } from "vitest";

import { pinnedLookup, vetDestination, type Resolver } from "./destination";

const PUBLIC = { allowLocalTargets: false };
const LOCAL = { allowLocalTargets: true };

const resolvesTo =
  (...addresses: string[]): Resolver =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

describe("vetDestination", () => {
  it("returns the first resolved address when all are public", async () => {
    const result = await vetDestination("https://hooks.example.com/in", {
      policy: PUBLIC,
      resolve: resolvesTo("93.184.216.34", "2606:2800:220:1::1"),
    });
    expect(result).toMatchObject({
      ok: true,
      destination: { address: "93.184.216.34", family: 4 },
    });
  });

  it("refuses a name that resolves to a private address (the DNS rebinding case)", async () => {
    const result = await vetDestination("https://innocent.example.com/in", {
      policy: PUBLIC,
      resolve: resolvesTo("10.0.0.5"),
    });
    expect(result).toMatchObject({
      ok: false,
      refusal: { kind: "blocked_address", reason: "private" },
    });
  });

  it("refuses when any one answer is private, even after public ones", async () => {
    const result = await vetDestination("https://mixed.example.com/in", {
      policy: PUBLIC,
      resolve: resolvesTo("93.184.216.34", "169.254.169.254"),
    });
    expect(result).toMatchObject({ ok: false, refusal: { reason: "metadata" } });
  });

  it("refuses IPv4-mapped IPv6 answers", async () => {
    const result = await vetDestination("https://sneaky.example.com/in", {
      policy: PUBLIC,
      resolve: resolvesTo("::ffff:127.0.0.1"),
    });
    expect(result).toMatchObject({ ok: false, refusal: { reason: "loopback" } });
  });

  it("refuses an IP literal without resolving anything", async () => {
    const resolve = vi.fn<Resolver>();
    const result = await vetDestination("https://10.1.2.3/in", { policy: PUBLIC, resolve });
    expect(result.ok).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("reports unresolvable names", async () => {
    const failing: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(
      await vetDestination("https://nope.example.com/", { policy: PUBLIC, resolve: failing }),
    ).toMatchObject({ ok: false, refusal: { kind: "unresolvable" } });
    expect(
      await vetDestination("https://empty.example.com/", { policy: PUBLIC, resolve: resolvesTo() }),
    ).toMatchObject({ ok: false, refusal: { kind: "unresolvable" } });
  });

  it("refuses an unsafe URL before resolving", async () => {
    const resolve = vi.fn<Resolver>();
    const result = await vetDestination("http://example.com/", { policy: PUBLIC, resolve });
    expect(result).toMatchObject({ ok: false, refusal: { kind: "invalid_url" } });
    expect(resolve).not.toHaveBeenCalled();
  });

  describe("with local targets allowed", () => {
    it("lets a loopback name reach loopback", async () => {
      const result = await vetDestination("http://localhost:4000/in", {
        policy: LOCAL,
        resolve: resolvesTo("127.0.0.1"),
      });
      expect(result).toMatchObject({ ok: true, destination: { address: "127.0.0.1" } });
    });

    it("lets a loopback literal through", async () => {
      expect(await vetDestination("http://127.0.0.1:4000/", { policy: LOCAL })).toMatchObject({
        ok: true,
      });
    });

    it("still refuses a public-looking name that resolves to loopback (rebinding)", async () => {
      const result = await vetDestination("https://innocent.example.com/", {
        policy: LOCAL,
        resolve: resolvesTo("127.0.0.1"),
      });
      expect(result).toMatchObject({ ok: false, refusal: { reason: "loopback" } });
    });

    it("never opens private ranges or metadata", async () => {
      expect(
        await vetDestination("http://localhost/", {
          policy: LOCAL,
          resolve: resolvesTo("10.0.0.1"),
        }),
      ).toMatchObject({ ok: false, refusal: { reason: "private" } });
      expect(await vetDestination("http://169.254.169.254/", { policy: LOCAL })).toMatchObject({
        ok: false,
      });
    });
  });
});

describe("pinnedLookup", () => {
  const lookup = pinnedLookup({ address: "93.184.216.34", family: 4 });

  it("answers any name with the vetted address (single-address form)", () => {
    const callback = vi.fn();
    lookup("anything.example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "93.184.216.34", 4);
  });

  it("answers the all-addresses form with only the vetted address", () => {
    const callback = vi.fn();
    lookup("anything.example.com", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });
});
