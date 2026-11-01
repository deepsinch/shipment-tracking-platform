import "server-only";

import http from "node:http";
import https from "node:https";

import { pinnedLookup, type VettedDestination } from "./destination";

/**
 * One HTTP POST to a vetted destination. No redirects are followed (Node's `http` never does),
 * the whole exchange has a deadline, and the response body is read only up to a cap, so a hostile
 * receiver can neither park a worker nor stream gigabytes into it.
 */

export const DELIVERY_TIMEOUT_MS = 5_000;
/** The body is never stored or shown; the cap only bounds what we are willing to read. */
export const MAX_RESPONSE_BYTES = 8 * 1024;

export type TransportResult =
  { kind: "response"; statusCode: number } | { kind: "error"; message: string };

export type TransportRequest = {
  destination: VettedDestination;
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type Transport = (request: TransportRequest) => Promise<TransportResult>;

export const postToDestination: Transport = ({
  destination,
  headers,
  body,
  timeoutMs = DELIVERY_TIMEOUT_MS,
  maxResponseBytes = MAX_RESPONSE_BYTES,
}) =>
  new Promise<TransportResult>((resolve) => {
    const { url } = destination;
    const secure = url.protocol === "https:";
    const signal = AbortSignal.timeout(timeoutMs);
    let settled = false;
    const finish = (result: TransportResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const request = (secure ? https : http).request(
      {
        // The name stays the host (Host header, SNI, certificate check); the lookup decides
        // where the socket really goes.
        hostname: url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        lookup: pinnedLookup(destination),
        // A fresh connection per delivery: nothing is reused across receivers.
        agent: false,
        signal,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxResponseBytes) {
            // Enough: the status is all we use. Dropping the connection stops the download.
            finish({ kind: "response", statusCode });
            response.destroy();
          }
        });
        response.on("end", () => finish({ kind: "response", statusCode }));
        response.on("error", () => finish({ kind: "response", statusCode }));
      },
    );

    request.on("error", (error: NodeJS.ErrnoException) => {
      if (signal.aborted) {
        finish({ kind: "error", message: `Timed out after ${timeoutMs / 1000} s` });
      } else {
        finish({ kind: "error", message: `Connection failed (${error.code ?? error.name})` });
      }
    });
    request.end(body);
  });
