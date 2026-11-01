import "server-only";

import { lookup } from "node:dns/promises";

import { classifyIpAddress, type BlockReason } from "@/domain/ip-address";
import {
  checkWebhookUrl,
  describeBlockReason,
  ipLiteralOf,
  isLoopbackHost,
  type UrlPolicy,
} from "@/domain/webhook-url";

/**
 * The SSRF guard at delivery time (docs/architecture.md, decision 51).
 *
 * A webhook URL is chosen by a customer, and the server calls it from inside our network, so a
 * hostile (or merely careless) URL could aim the server at things only it can reach: the cloud
 * metadata service, a database on a private address, an admin port on localhost. The save-time
 * check (`checkWebhookUrl`) gives quick feedback but cannot be the defence: a name that resolves to
 * a public address today can resolve to `169.254.169.254` tomorrow (DNS rebinding), and a
 * redirect could do the same.
 *
 * So delivery does its own check, in three parts that only work together:
 *   1. Resolve the host name now and judge **every** address it returns (one private answer among
 *      public ones refuses the target: an attacker controls the record set).
 *   2. Connect to **the address that was vetted** (`pinnedLookup`), not to the name. The socket
 *      never asks DNS again, so nothing can change between the check and the connect. TLS still
 *      validates the certificate against the host name and sends it as SNI.
 *   3. Never follow redirects (see `transport.ts`): a 3xx is a failed delivery, not a new target.
 */

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** The system resolver, all addresses in the order the OS prefers. Injectable for tests. */
export const systemResolver: Resolver = async (hostname) => {
  const found = await lookup(hostname, { all: true, verbatim: true });
  return found.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family } as ResolvedAddress] : [],
  );
};

export type VettedDestination = {
  url: URL;
  /** The address to connect to. Always one that passed the check. */
  address: string;
  family: 4 | 6;
};

export type Refusal =
  | { kind: "invalid_url"; message: string }
  | { kind: "unresolvable"; message: string }
  | { kind: "blocked_address"; reason: BlockReason; message: string };

export type VetResult =
  { ok: true; destination: VettedDestination } | { ok: false; refusal: Refusal };

/** Resolves and judges `rawUrl`; the destination to connect to, or why it is refused. */
export async function vetDestination(
  rawUrl: string,
  options: { policy: UrlPolicy; resolve?: Resolver },
): Promise<VetResult> {
  const checked = checkWebhookUrl(rawUrl, options.policy);
  if (!checked.ok) return { ok: false, refusal: { kind: "invalid_url", message: checked.message } };
  const { url } = checked;

  const literal = ipLiteralOf(url.hostname);
  let candidates: ResolvedAddress[];
  if (literal) {
    candidates = [{ address: literal, family: literal.includes(":") ? 6 : 4 }];
  } else {
    try {
      candidates = await (options.resolve ?? systemResolver)(url.hostname);
    } catch {
      return {
        ok: false,
        refusal: { kind: "unresolvable", message: `Could not resolve ${url.hostname}` },
      };
    }
    if (candidates.length === 0) {
      return {
        ok: false,
        refusal: { kind: "unresolvable", message: `Could not resolve ${url.hostname}` },
      };
    }
  }

  // Loopback is opened up for development and tests only, and only for a loopback *name or
  // literal*: a public-looking host that resolves to 127.0.0.1 is still a rebinding attempt.
  const loopbackOk = options.policy.allowLocalTargets && isLoopbackHost(url.hostname);
  for (const candidate of candidates) {
    const verdict = classifyIpAddress(candidate.address);
    if (verdict.blocked && !(loopbackOk && verdict.reason === "loopback")) {
      return {
        ok: false,
        refusal: {
          kind: "blocked_address",
          reason: verdict.reason,
          message: `Refused: ${url.hostname} resolves to ${candidate.address}, which ${describeBlockReason(verdict.reason)}`,
        },
      };
    }
  }
  return {
    ok: true,
    destination: { url, address: candidates[0]!.address, family: candidates[0]!.family },
  };
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * A `lookup` function for `http(s).request` that answers every query with the vetted address,
 * whatever name is asked for. Handles both call styles Node uses (`all: true` when it tries
 * several families, a single address otherwise).
 */
export function pinnedLookup(destination: Pick<VettedDestination, "address" | "family">) {
  return (_hostname: string, options: { all?: boolean } | undefined, callback: LookupCallback) => {
    if (options?.all) {
      callback(null, [{ address: destination.address, family: destination.family }]);
    } else {
      callback(null, destination.address, destination.family);
    }
  };
}
