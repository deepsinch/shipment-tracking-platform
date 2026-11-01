import http from "node:http";
import type { AddressInfo } from "node:net";

export type ReceivedRequest = {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
};

/** What the receiver answers to the n-th request (0-based): a status, or "hang" to never answer. */
export type Behaviour = (index: number) => number | "hang" | { redirectTo: string };

/**
 * A local HTTP receiver for webhook tests, on 127.0.0.1. It records every request; `behaviour`
 * decides the answer; `gate` (when set) holds each response until it resolves, so a test can
 * keep a delivery in flight while it does something else.
 */
export class TestReceiver {
  readonly requests: ReceivedRequest[] = [];
  gate: Promise<void> | null = null;
  private server = http.createServer();
  port = 0;

  constructor(private behaviour: Behaviour = () => 200) {
    this.server.on("request", (request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", async () => {
        const index = this.requests.length;
        this.requests.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body,
        });
        if (this.gate) await this.gate;
        const answer = this.behaviour(index);
        if (answer === "hang") return;
        if (typeof answer === "object") {
          response.writeHead(302, { Location: answer.redirectTo }).end();
        } else {
          response.writeHead(answer).end("ok");
        }
      });
    });
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/hook`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }
}
