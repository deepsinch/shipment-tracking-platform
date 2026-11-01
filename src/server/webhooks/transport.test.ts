import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { postToDestination } from "./transport";

type Seen = {
  method?: string;
  url?: string;
  host?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};

const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/** A destination whose *name* resolves nowhere: only the pinned address can be reached. */
const destinationOn = (port: number, path = "/hook") => ({
  url: new URL(`http://receiver.invalid:${port}${path}`),
  address: "127.0.0.1",
  family: 4 as const,
});

describe("postToDestination", () => {
  it("connects to the vetted address, not to the name, and keeps the name as Host", async () => {
    let seen: Seen | undefined;
    const port = await listen((request, response) => {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        seen = { method: request.method, url: request.url, headers: request.headers, body };
        response.writeHead(204).end();
      });
    });

    const result = await postToDestination({
      destination: destinationOn(port, "/in?x=1"),
      headers: { "Content-Type": "application/json", "Waybill-Event": "shipment.created" },
      body: '{"a":1}',
    });

    expect(result).toEqual({ kind: "response", statusCode: 204 });
    expect(seen).toMatchObject({ method: "POST", url: "/in?x=1", body: '{"a":1}' });
    expect(seen!.headers.host).toBe(`receiver.invalid:${port}`);
    expect(seen!.headers["waybill-event"]).toBe("shipment.created");
    expect(seen!.headers["content-length"]).toBe("7");
  });

  it("does not follow a redirect: it reports the 3xx and never contacts the target", async () => {
    let targetHits = 0;
    const targetPort = await listen((_request, response) => {
      targetHits += 1;
      response.writeHead(200).end();
    });
    const port = await listen((_request, response) => {
      response.writeHead(302, { Location: `http://127.0.0.1:${targetPort}/` }).end();
    });

    const result = await postToDestination({
      destination: destinationOn(port),
      headers: {},
      body: "{}",
    });

    expect(result).toEqual({ kind: "response", statusCode: 302 });
    expect(targetHits).toBe(0);
  });

  it("gives up at the deadline when the receiver never answers", async () => {
    const port = await listen(() => {
      /* never respond */
    });
    const started = Date.now();
    const result = await postToDestination({
      destination: destinationOn(port),
      headers: {},
      body: "{}",
      timeoutMs: 150,
    });
    expect(result).toEqual({ kind: "error", message: "Timed out after 0.15 s" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("stops reading a huge or endless response body at the cap", async () => {
    const port = await listen((_request, response) => {
      response.writeHead(200);
      const chunk = Buffer.alloc(16 * 1024, "x");
      const timer = setInterval(() => response.write(chunk), 1);
      response.on("close", () => clearInterval(timer));
    });
    const result = await postToDestination({
      destination: destinationOn(port),
      headers: {},
      body: "{}",
      maxResponseBytes: 1024,
      timeoutMs: 3_000,
    });
    expect(result).toEqual({ kind: "response", statusCode: 200 });
  });

  it("reports a refused connection without throwing", async () => {
    const port = await listen((_request, response) => response.end());
    const [server] = servers.splice(0);
    await new Promise((resolve) => server!.close(resolve));
    const result = await postToDestination({
      destination: destinationOn(port),
      headers: {},
      body: "{}",
    });
    expect(result).toEqual({ kind: "error", message: "Connection failed (ECONNREFUSED)" });
  });
});
