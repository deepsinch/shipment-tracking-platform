import { describe, expect, it } from "vitest";

import { classifyIpAddress, parseIPv4, parseIPv6, type BlockReason } from "./ip-address";

const blockedAs = (reason: BlockReason) => ({ blocked: true, reason });
const OK = { blocked: false };

describe("parseIPv4", () => {
  it("reads dotted quads", () => {
    expect(parseIPv4("1.2.3.4")).toEqual([1, 2, 3, 4]);
    expect(parseIPv4("255.255.255.255")).toEqual([255, 255, 255, 255]);
  });

  it.each(["", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.04", "01.2.3.4", "1.2.3.-4", "a.b.c.d"])(
    "rejects %j",
    (text) => expect(parseIPv4(text)).toBeNull(),
  );
});

describe("parseIPv6", () => {
  it("expands compression", () => {
    expect(parseIPv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6("2001:db8::ff00:42:8329")).toEqual([
      0x2001, 0xdb8, 0, 0, 0, 0xff00, 0x42, 0x8329,
    ]);
    expect(parseIPv6("1:2:3:4:5:6:7:8")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("reads an embedded IPv4 tail", () => {
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6("64:ff9b::10.0.0.1")).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0x0a00, 1]);
  });

  it("ignores a zone id", () => {
    expect(parseIPv6("fe80::1%eth0")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });

  it.each([
    "",
    "1.2.3.4",
    "::g",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8:9",
    "1::2::3",
    "12345::1",
    "1:2:3:4:5:6:7::8",
    "::ffff:1.2.3",
  ])("rejects %j", (text) => expect(parseIPv6(text)).toBeNull());
});

describe("classifyIpAddress", () => {
  it.each([
    // Public addresses.
    ["8.8.8.8", OK],
    ["1.1.1.1", OK],
    ["93.184.216.34", OK],
    ["172.15.255.255", OK],
    ["172.32.0.0", OK],
    ["100.63.255.255", OK],
    ["100.128.0.0", OK],
    ["169.253.1.1", OK],
    ["192.167.1.1", OK],
    ["198.17.255.255", OK],
    ["198.20.0.0", OK],
    ["223.255.255.255", OK],
    ["2606:4700:4700::1111", OK],
    ["2a00:1450:4001:81b::200e", OK],
    ["2001:4860:4860::8888", OK],
    ["2002:808:808::1", OK], // 6to4 around 8.8.8.8
    ["::ffff:8.8.8.8", OK],
    ["64:ff9b::808:808", OK], // NAT64 around 8.8.8.8
    // Unspecified.
    ["0.0.0.0", blockedAs("unspecified")],
    ["0.1.2.3", blockedAs("unspecified")],
    ["::", blockedAs("unspecified")],
    // Loopback.
    ["127.0.0.1", blockedAs("loopback")],
    ["127.255.255.254", blockedAs("loopback")],
    ["::1", blockedAs("loopback")],
    ["0:0:0:0:0:0:0:1", blockedAs("loopback")],
    // Private.
    ["10.0.0.0", blockedAs("private")],
    ["10.255.255.255", blockedAs("private")],
    ["172.16.0.1", blockedAs("private")],
    ["172.31.255.255", blockedAs("private")],
    ["192.168.0.1", blockedAs("private")],
    ["fc00::1", blockedAs("private")],
    ["fd12:3456:789a::1", blockedAs("private")],
    ["fec0::1", blockedAs("private")],
    // Link-local.
    ["169.254.0.1", blockedAs("link_local")],
    ["169.254.169.253", blockedAs("link_local")],
    ["fe80::1", blockedAs("link_local")],
    ["febf::1", blockedAs("link_local")],
    // Shared address space (CGNAT).
    ["100.64.0.0", blockedAs("shared")],
    ["100.100.100.200", blockedAs("shared")],
    ["100.127.255.255", blockedAs("shared")],
    // Multicast.
    ["224.0.0.1", blockedAs("multicast")],
    ["239.255.255.255", blockedAs("multicast")],
    ["ff02::1", blockedAs("multicast")],
    ["ff00::", blockedAs("multicast")],
    // Cloud metadata.
    ["169.254.169.254", blockedAs("metadata")],
    ["fd00:ec2::254", blockedAs("metadata")],
    ["FD00:EC2:0:0:0:0:0:254", blockedAs("metadata")],
    // Reserved.
    ["240.0.0.1", blockedAs("reserved")],
    ["255.255.255.255", blockedAs("reserved")],
    ["192.0.0.1", blockedAs("reserved")],
    ["198.18.0.1", blockedAs("reserved")],
    ["198.19.255.255", blockedAs("reserved")],
    ["192.88.99.1", blockedAs("reserved")],
    ["2001::1", blockedAs("reserved")], // Teredo
    ["100::1", blockedAs("reserved")],
    ["::2", blockedAs("reserved")], // IPv4-compatible form
    ["64:ff9b:1::1", blockedAs("reserved")],
    ["4000::1", blockedAs("reserved")], // outside 2000::/3
    // Documentation.
    ["192.0.2.1", blockedAs("documentation")],
    ["198.51.100.7", blockedAs("documentation")],
    ["203.0.113.9", blockedAs("documentation")],
    ["2001:db8::1", blockedAs("documentation")],
    ["3fff::1", blockedAs("documentation")],
    // IPv4 inside IPv6 is judged by the IPv4 address.
    ["::ffff:127.0.0.1", blockedAs("loopback")],
    ["::ffff:7f00:1", blockedAs("loopback")],
    ["::ffff:10.1.2.3", blockedAs("private")],
    ["::ffff:169.254.169.254", blockedAs("metadata")],
    ["::ffff:100.64.0.1", blockedAs("shared")],
    ["0:0:0:0:0:ffff:192.168.1.1", blockedAs("private")],
    ["64:ff9b::7f00:1", blockedAs("loopback")],
    ["64:ff9b::169.254.169.254", blockedAs("metadata")],
    ["2002:7f00:1::1", blockedAs("loopback")],
    ["2002:a9fe:a9fe::1", blockedAs("metadata")],
    // Not an address.
    ["", blockedAs("invalid")],
    ["localhost", blockedAs("invalid")],
    ["example.com", blockedAs("invalid")],
    ["1.2.3", blockedAs("invalid")],
    ["2130706433", blockedAs("invalid")],
    ["0x7f.0.0.1", blockedAs("invalid")],
    ["[::1]", blockedAs("invalid")],
  ])("%s", (address, verdict) => {
    expect(classifyIpAddress(address)).toEqual(verdict);
  });

  it("covers every octet boundary of the private IPv4 ranges", () => {
    for (let b = 0; b < 256; b++) {
      const expected = b >= 16 && b <= 31 ? "private" : null;
      const verdict = classifyIpAddress(`172.${b}.1.1`);
      expect(verdict.blocked ? verdict.reason : null).toBe(expected);
    }
    for (let b = 0; b < 256; b++) {
      const expected = b >= 64 && b <= 127 ? "shared" : null;
      const verdict = classifyIpAddress(`100.${b}.1.1`);
      expect(verdict.blocked ? verdict.reason : null).toBe(expected);
    }
  });
});
