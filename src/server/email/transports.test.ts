import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createResendTransport, previewTransport, type OutgoingEmail } from "./transports";

const email: OutgoingEmail = {
  from: "Waybill <notifications@example.com>",
  to: "ada@example.com",
  subject: "Your shipment has been delivered (WB-1)",
  text: "plain",
  html: "<p>html</p>",
  idempotencyKey: "waybill-status-email/1234",
  headers: { "List-Unsubscribe": "<https://app.example/unsubscribe/x>" },
};

type Seen = { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };

const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

/** A fake Resend API on this machine. `answer` decides the response; every request is recorded. */
async function fakeResend(answer: (seen: Seen, response: http.ServerResponse) => void) {
  const requests: Seen[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const seen = { method: request.method, url: request.url, headers: request.headers, body };
      requests.push(seen);
      answer(seen, response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { requests, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const json = (response: http.ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
};

describe("Resend transport (against a fake API)", () => {
  it("posts the documented request: bearer key, idempotency key, from/to/subject/text/html/headers", async () => {
    const api = await fakeResend((_seen, response) => json(response, 200, { id: "re_msg_1" }));

    const result = await createResendTransport({
      apiKey: "re_test_key",
      baseUrl: api.baseUrl,
    }).send(email);

    expect(result).toEqual({ kind: "sent", providerMessageId: "re_msg_1" });
    const [request] = api.requests;
    expect(request).toMatchObject({ method: "POST", url: "/emails" });
    expect(request!.headers.authorization).toBe("Bearer re_test_key");
    expect(request!.headers["idempotency-key"]).toBe("waybill-status-email/1234");
    expect(request!.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(request!.body)).toEqual({
      from: email.from,
      to: ["ada@example.com"],
      subject: email.subject,
      text: "plain",
      html: "<p>html</p>",
      headers: email.headers,
    });
  });

  it("sends the same idempotency key on every retry of a message", async () => {
    const api = await fakeResend((_seen, response) =>
      json(response, 500, { message: "try later" }),
    );
    const transport = createResendTransport({ apiKey: "re_k", baseUrl: api.baseUrl });
    await transport.send(email);
    await transport.send(email);
    expect(api.requests.map((r) => r.headers["idempotency-key"])).toEqual([
      "waybill-status-email/1234",
      "waybill-status-email/1234",
    ]);
  });

  it("reports an API error with its status and message, never the key", async () => {
    const api = await fakeResend((_seen, response) =>
      json(response, 422, { name: "validation_error", message: "Invalid `to` field" }),
    );
    const result = await createResendTransport({
      apiKey: "re_secret_key",
      baseUrl: api.baseUrl,
    }).send(email);
    expect(result).toEqual({
      kind: "failed",
      message: "Resend answered 422: Invalid `to` field",
      permanent: true,
    });
    expect(JSON.stringify(result)).not.toContain("re_secret_key");
  });

  it("reports a non-JSON error body by status alone", async () => {
    const api = await fakeResend((_seen, response) =>
      response.writeHead(502).end("<html>bad gateway</html>"),
    );
    expect(await createResendTransport({ apiKey: "k", baseUrl: api.baseUrl }).send(email)).toEqual({
      kind: "failed",
      message: "Resend answered 502",
      permanent: false,
    });
  });

  it("does not follow a redirect (the key must not travel)", async () => {
    let elsewhere = 0;
    const target = await fakeResend((_seen, response) => {
      elsewhere += 1;
      json(response, 200, { id: "x" });
    });
    const api = await fakeResend((_seen, response) =>
      response.writeHead(307, { Location: `${target.baseUrl}/emails` }).end(),
    );
    const result = await createResendTransport({ apiKey: "k", baseUrl: api.baseUrl }).send(email);
    expect(result.kind).toBe("failed");
    expect(elsewhere).toBe(0);
  });

  it("fails after the deadline when Resend never answers", async () => {
    const api = await fakeResend(() => {
      /* never answer */
    });
    const result = await createResendTransport({
      apiKey: "k",
      baseUrl: api.baseUrl,
      timeoutMs: 150,
    }).send(email);
    expect(result).toEqual({ kind: "failed", message: "Resend did not answer in time" });
  });

  it("fails cleanly when Resend cannot be reached", async () => {
    const api = await fakeResend(() => undefined);
    const [server] = servers.splice(0);
    await new Promise((resolve) => server!.close(resolve));
    expect(await createResendTransport({ apiKey: "k", baseUrl: api.baseUrl }).send(email)).toEqual({
      kind: "failed",
      message: "Could not reach Resend",
    });
  });
});

describe("preview transport", () => {
  it("accepts every message without sending anything", async () => {
    expect(previewTransport.name).toBe("preview");
    expect(await previewTransport.send(email)).toEqual({ kind: "sent", providerMessageId: null });
  });
});
