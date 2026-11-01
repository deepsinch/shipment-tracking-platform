/**
 * Which IP addresses a webhook may be delivered to (docs/architecture.md, decision 51). Pure:
 * the address text goes in, a verdict comes out, so the whole table is unit tested.
 *
 * The rule is "public unicast addresses only". Everything that is private, loopback, link-local,
 * shared (CGNAT), multicast, unspecified, reserved, documentation or cloud metadata is refused,
 * for IPv4 and IPv6. IPv6 forms that embed an IPv4 address (IPv4-mapped `::ffff:a.b.c.d`, NAT64
 * `64:ff9b::/96`, 6to4 `2002::/16`, the deprecated IPv4-compatible `::a.b.c.d`) are judged by the
 * IPv4 address inside, so `::ffff:127.0.0.1` cannot sneak past an IPv4-only list.
 */

export const BLOCK_REASONS = [
  "invalid",
  "unspecified",
  "loopback",
  "private",
  "link_local",
  "shared",
  "multicast",
  "reserved",
  "documentation",
  "metadata",
] as const;

export type BlockReason = (typeof BLOCK_REASONS)[number];

export type IpVerdict = { blocked: false } | { blocked: true; reason: BlockReason };

const allowed: IpVerdict = { blocked: false };
const blocked = (reason: BlockReason): IpVerdict => ({ blocked: true, reason });

/** Parses dotted-quad IPv4 into four octets, or null. Rejects leading zeros (ambiguous octal). */
export function parseIPv4(text: string): [number, number, number, number] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets as [number, number, number, number];
}

/** Parses IPv6 text (with `::` compression and an optional dotted IPv4 tail) into 8 groups, or null. */
export function parseIPv6(text: string): number[] | null {
  // A zone id ("fe80::1%eth0") is not part of the address.
  let address = text.split("%")[0]!;
  if (!address.includes(":") || /[^0-9a-fA-F:.]/.test(address)) return null;

  // A dotted IPv4 tail ("::ffff:1.2.3.4") is two more groups: rewrite it as hex first.
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const hex = (high: number, low: number) => ((high << 8) | low).toString(16);
    address = `${address.slice(0, lastColon + 1)}${hex(v4[0], v4[1])}:${hex(v4[2], v4[3])}`;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const values: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      values.push(parseInt(group, 16));
    }
    return values;
  };

  const left = parseGroups(halves[0]!);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parseGroups(halves[1]!);
  if (!right) return null;
  // "::" stands for at least one group of zeros.
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right];
}

function classifyV4(o: readonly [number, number, number, number]): IpVerdict {
  const [a, b, c, d] = o;
  if (a === 169 && b === 254 && c === 169 && d === 254) return blocked("metadata");
  if (a === 0) return blocked("unspecified"); // 0.0.0.0/8 ("this network"); 0.0.0.0 itself
  if (a === 127) return blocked("loopback");
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return blocked("private");
  }
  if (a === 169 && b === 254) return blocked("link_local");
  if (a === 100 && b >= 64 && b <= 127) return blocked("shared"); // CGNAT 100.64.0.0/10
  if (a >= 224 && a <= 239) return blocked("multicast");
  if (a >= 240) return blocked("reserved"); // 240.0.0.0/4 including 255.255.255.255
  if (
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast (deprecated)
    (a === 198 && (b === 18 || b === 19)) // benchmarking 198.18.0.0/15
  ) {
    return blocked("reserved");
  }
  if (
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return blocked("documentation");
  }
  return allowed;
}

const groupsToV4 = (high: number, low: number): [number, number, number, number] => [
  high >> 8,
  high & 0xff,
  low >> 8,
  low & 0xff,
];

function classifyV6(g: readonly number[]): IpVerdict {
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);

  // fd00:ec2::254 (AWS IMDS over IPv6) lives in the unique-local range: name it before that rule.
  if (g[0] === 0xfd00 && g[1] === 0x0ec2 && allZero(2, 7) && g[7] === 0x0254) {
    return blocked("metadata");
  }
  if (allZero(0, 8)) return blocked("unspecified");
  if (allZero(0, 7) && g[7] === 1) return blocked("loopback");

  // Forms with an IPv4 address inside are judged by it.
  if (allZero(0, 5) && g[5] === 0xffff) return classifyV4(groupsToV4(g[6]!, g[7]!)); // ::ffff:a.b.c.d
  if (allZero(0, 6)) return blocked("reserved"); // deprecated IPv4-compatible ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) {
    return classifyV4(groupsToV4(g[6]!, g[7]!)); // NAT64 64:ff9b::/96
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return blocked("reserved"); // 64:ff9b:1::/48
  if (g[0] === 0x2002) return classifyV4(groupsToV4(g[1]!, g[2]!)); // 6to4: IPv4 in bits 16-47

  if ((g[0]! & 0xfe00) === 0xfc00) return blocked("private"); // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return blocked("link_local"); // fe80::/10
  if ((g[0]! & 0xffc0) === 0xfec0) return blocked("private"); // fec0::/10 site-local (deprecated)
  if ((g[0]! & 0xff00) === 0xff00) return blocked("multicast"); // ff00::/8
  if (g[0] === 0x2001 && g[1] === 0x0db8) return blocked("documentation"); // 2001:db8::/32
  if (g[0] === 0x3fff && (g[1]! & 0xf000) === 0) return blocked("documentation"); // 3fff::/20
  if (g[0] === 0x2001 && g[1]! < 0x200) return blocked("reserved"); // 2001::/23 incl. Teredo
  if (g[0] === 0x0100 && allZero(1, 4)) return blocked("reserved"); // 100::/64 discard-only

  // Only 2000::/3 is global unicast today; anything else is unassigned.
  return (g[0]! & 0xe000) === 0x2000 ? allowed : blocked("reserved");
}

/** Judges an address in text form (IPv4, or IPv6 in any notation). Unparseable input is blocked. */
export function classifyIpAddress(text: string): IpVerdict {
  const v4 = parseIPv4(text);
  if (v4) return classifyV4(v4);
  const v6 = parseIPv6(text);
  if (v6) return classifyV6(v6);
  return blocked("invalid");
}
