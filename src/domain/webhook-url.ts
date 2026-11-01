import { classifyIpAddress, parseIPv4, parseIPv6, type BlockReason } from "./ip-address";

/**
 * Webhook URL rules that need no network, shared by the save-time check (fast feedback in the
 * form) and the delivery-time guard (which adds DNS and is the one that counts).
 * See docs/architecture.md, decision 51.
 */

export type UrlPolicy = {
  /**
   * Development and tests only: allow `http://` and loopback targets (localhost, 127.0.0.1, ::1).
   * Everything else stays refused, in particular private ranges and cloud metadata addresses.
   */
  allowLocalTargets: boolean;
};

export const MAX_WEBHOOK_URL_LENGTH = 2000;

/** The host as an address when it is an IP literal (brackets stripped from IPv6), else null. */
export function ipLiteralOf(hostname: string): string | null {
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return parseIPv4(bare) || parseIPv6(bare) ? bare : null;
}

/** Names that only mean something on the machine or network running the code. */
export function isLocalHostname(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/\.$/, "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".local") ||
    name.endsWith(".internal") ||
    name.endsWith(".localdomain") ||
    name.endsWith(".home.arpa") ||
    // A single label ("intranet", "db") only resolves through a search domain.
    !name.includes(".")
  );
}

/** Whether a host is the machine itself, the one thing `allowLocalTargets` opens up. */
export function isLoopbackHost(hostname: string): boolean {
  const literal = ipLiteralOf(hostname);
  if (literal) {
    const verdict = classifyIpAddress(literal);
    return verdict.blocked && verdict.reason === "loopback";
  }
  const name = hostname.toLowerCase().replace(/\.$/, "");
  return name === "localhost" || name.endsWith(".localhost");
}

export type WebhookUrlCheck = { ok: true; url: URL } | { ok: false; message: string };

const REASON_TEXT: Record<BlockReason, string> = {
  invalid: "is not a valid address",
  unspecified: "is the unspecified address",
  loopback: "is a loopback address",
  private: "is a private network address",
  link_local: "is a link-local address",
  shared: "is a shared (carrier-grade NAT) address",
  multicast: "is a multicast address",
  reserved: "is a reserved address",
  documentation: "is a documentation address",
  metadata: "is a cloud metadata address",
};

export function describeBlockReason(reason: BlockReason): string {
  return REASON_TEXT[reason];
}

/**
 * Checks what can be known from the URL text alone: https only (http for loopback under
 * `allowLocalTargets`), no credentials, a public-looking host, and no private IP literal. The
 * hostname is not resolved here; the delivery-time guard resolves it and checks the addresses.
 */
export function checkWebhookUrl(raw: string, policy: UrlPolicy): WebhookUrlCheck {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, message: "Enter the URL to send events to" };
  if (text.length > MAX_WEBHOOK_URL_LENGTH) {
    return { ok: false, message: `Use at most ${MAX_WEBHOOK_URL_LENGTH} characters` };
  }
  if (!URL.canParse(text))
    return { ok: false, message: "Enter a full URL, e.g. https://example.com/hooks" };
  const url = new URL(text);

  const local = policy.allowLocalTargets && isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    return { ok: false, message: "The URL must start with https://" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "Remove the username and password from the URL" };
  }

  const literal = ipLiteralOf(url.hostname);
  if (literal) {
    const verdict = classifyIpAddress(literal);
    if (verdict.blocked && !(local && verdict.reason === "loopback")) {
      return { ok: false, message: `That address ${describeBlockReason(verdict.reason)}` };
    }
  } else if (isLocalHostname(url.hostname) && !local) {
    return { ok: false, message: "Use a public host name; local and internal names are refused" };
  }
  return { ok: true, url };
}
