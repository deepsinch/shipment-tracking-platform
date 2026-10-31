import { randomUUID } from "node:crypto";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseRealtimeClientEvent, type RealtimeClientEvent } from "@/lib/realtime-events";
import { getAuth } from "@/server/auth/auth";
import type { AuthContext } from "@/server/auth/auth-context";
import { getAuthContextFromHeaders } from "@/server/auth/request-context";
import { signUpWithOrganization } from "@/server/auth/sign-up";
import { assignDriver } from "@/server/services/assign-driver";
import { changeShipmentStatus } from "@/server/services/change-shipment-status";
import { createShipment } from "@/server/services/create-shipment";
import { recordLocationPing } from "@/server/services/record-location-ping";

import { eventually } from "../../../../tests/integration/realtime";
import { GET } from "./route";

/**
 * The realtime endpoint, invoked with constructed requests carrying real Better Auth session
 * cookies, with events produced by the real services. Proving that an event did NOT reach a stream
 * uses a sentinel: a later event the stream may see. Postgres delivers notifications in commit
 * order and each stream preserves it, so once the sentinel is there, the earlier event would be
 * too.
 */

const PASSWORD = "correct-horse-battery";

async function cookieFor(email: string): Promise<Headers> {
  const { headers } = await getAuth().api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

type Member = { ctx: AuthContext; headers: Headers };

async function newOrganization(): Promise<{ admin: Member; addDriver: () => Promise<Member> }> {
  const email = `${randomUUID()}@example.test`;
  const result = await signUpWithOrganization({
    name: "Ada Admin",
    email,
    password: PASSWORD,
    organizationName: "Stream Test Freight",
  });
  if (!result.ok) throw new Error(`sign-up failed: ${JSON.stringify(result)}`);
  const member = async (memberEmail: string): Promise<Member> => {
    const headers = await cookieFor(memberEmail);
    const ctx = await getAuthContextFromHeaders(headers);
    if (!ctx) throw new Error("no AuthContext for the new member");
    return { ctx, headers };
  };

  return {
    admin: await member(email),
    addDriver: async () => {
      const driverEmail = `${randomUUID()}@example.test`;
      const { user } = await getAuth().api.signUpEmail({
        body: { name: "Dee Driver", email: driverEmail, password: PASSWORD },
      });
      await getAuth().api.addMember({
        body: { userId: user.id, organizationId: result.organizationId, role: "driver" },
      });
      return member(driverEmail);
    },
  };
}

/** Opens the stream as `headers`' user and parses its events as they arrive. */
async function openStream(headers: Headers) {
  const abort = new AbortController();
  const response = await GET(
    new Request("http://localhost/api/realtime", { headers, signal: abort.signal }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");

  const events: RealtimeClientEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const event = parseRealtimeClientEvent(line.slice("data: ".length));
          if (!event) throw new Error(`unparseable event: ${line}`);
          events.push(event);
        }
      }
    }
  })();

  const stream = {
    events,
    abort: () => abort.abort(),
    about: (shipmentId: string) =>
      events.filter((event) => event.kind !== "resync" && event.shipmentId === shipmentId),
    async waitFor(shipmentId: string, count = 1) {
      await eventually(
        () => stream.about(shipmentId).length >= count,
        `${count} event(s) about ${shipmentId}; got ${JSON.stringify(events)}`,
      );
    },
  };
  // Listening once the first resync arrives; events committed after that are delivered.
  await eventually(() => events.some((event) => event.kind === "resync"), "the first resync");
  return stream;
}

const shipmentInput = (assignedDriverId?: string) => ({
  recipientName: "Ada Recipient",
  originAddressLine: "1 Origin Street",
  originCity: "Rotterdam",
  originCountry: "NL",
  destinationAddressLine: "2 Destination Road",
  destinationCity: "Antwerp",
  destinationCountry: "BE",
  weightKg: 10,
  assignedDriverId,
});

async function book(admin: Member, driver?: Member) {
  const result = await createShipment(admin.ctx, shipmentInput(driver?.ctx.userId));
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.shipment;
}

describe("GET /api/realtime", () => {
  const streams: { abort: () => void }[] = [];
  const track = <T extends { abort: () => void }>(stream: T) => {
    streams.push(stream);
    return stream;
  };
  afterEach(() => streams.splice(0).forEach((stream) => stream.abort()));

  it("answers 401, not a redirect, without a valid session", async () => {
    const anonymous = await GET(new Request("http://localhost/api/realtime"));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("location")).toBeNull();

    const forged = await GET(
      new Request("http://localhost/api/realtime", {
        headers: { cookie: "better-auth.session_token=forged.value" },
      }),
    );
    expect(forged.status).toBe(401);
  });

  describe("organization isolation", () => {
    let orgA: Awaited<ReturnType<typeof newOrganization>>;
    let orgB: Awaited<ReturnType<typeof newOrganization>>;

    beforeAll(async () => {
      orgA = await newOrganization();
      orgB = await newOrganization();
    });

    it("never sends one organization's events to another's stream", async () => {
      const streamA = track(await openStream(orgA.admin.headers));
      const streamB = track(await openStream(orgB.admin.headers));
      const driverB = await orgB.addDriver();

      // Organization B: a booking, a status change, an assignment and a position.
      const shipmentB = await book(orgB.admin);
      await assignDriver(orgB.admin.ctx, {
        shipmentId: shipmentB.id,
        expectedVersion: 1,
        driverId: driverB.ctx.userId,
      });
      await changeShipmentStatus(driverB.ctx, {
        shipmentId: shipmentB.id,
        expectedVersion: 2,
        toStatus: "picked_up",
      });
      await recordLocationPing(driverB.ctx, {
        shipmentId: shipmentB.id,
        lat: 51.2,
        lng: 4.4,
        accuracyM: 5,
        recordedAt: new Date().toISOString(),
      });
      // Then a sentinel in organization A.
      const sentinelA = await book(orgA.admin);

      await streamA.waitFor(sentinelA.id);
      await streamB.waitFor(shipmentB.id, 4);
      expect(streamA.about(shipmentB.id)).toEqual([]);
      expect(streamB.about(sentinelA.id)).toEqual([]);
      expect(streamB.about(shipmentB.id).map((event) => event.kind)).toEqual([
        "shipment_changed",
        "shipment_changed",
        "shipment_changed",
        "position",
      ]);
    });

    it("sends only the client projection, without organization or user ids", async () => {
      const stream = track(await openStream(orgA.admin.headers));
      const driver = await orgA.addDriver();

      const shipment = await book(orgA.admin, driver);
      await stream.waitFor(shipment.id);

      expect(stream.about(shipment.id)).toEqual([
        { kind: "shipment_changed", shipmentId: shipment.id, reason: "created" },
      ]);
      expect(JSON.stringify(stream.events)).not.toContain(driver.ctx.userId);
      expect(JSON.stringify(stream.events)).not.toContain(orgA.admin.ctx.organizationId);
    });
  });

  describe("driver scope", () => {
    it("sends a driver only their shipments, including the one reassigned away", async () => {
      const org = await newOrganization();
      const driver1 = await org.addDriver();
      const driver2 = await org.addDriver();
      const stream1 = track(await openStream(driver1.headers));
      const stream2 = track(await openStream(driver2.headers));
      const office = track(await openStream(org.admin.headers));

      // Booked for driver 1: only driver 1 hears about it.
      const shipment = await book(org.admin, driver1);
      const unassigned = await book(org.admin);
      await stream1.waitFor(shipment.id);

      // Reassigned to driver 2: both hear it, driver 1 so that it leaves their list.
      await assignDriver(org.admin.ctx, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        driverId: driver2.ctx.userId,
      });
      await stream1.waitFor(shipment.id, 2);
      await stream2.waitFor(shipment.id, 1);

      // Now driver 2's: driver 1 no longer hears its status changes or positions.
      await changeShipmentStatus(driver2.ctx, {
        shipmentId: shipment.id,
        expectedVersion: 2,
        toStatus: "picked_up",
      });
      await recordLocationPing(driver2.ctx, {
        shipmentId: shipment.id,
        lat: 51.2,
        lng: 4.4,
        accuracyM: 5,
        recordedAt: new Date().toISOString(),
      });
      // Sentinel for driver 1, after everything above.
      const sentinel1 = await book(org.admin, driver1);
      await stream1.waitFor(sentinel1.id);
      await stream2.waitFor(shipment.id, 3);
      await office.waitFor(sentinel1.id);

      const reasons = (events: RealtimeClientEvent[]) =>
        events.map((event) => (event.kind === "shipment_changed" ? event.reason : event.kind));
      expect(reasons(stream1.about(shipment.id))).toEqual(["created", "assignment"]);
      expect(reasons(stream2.about(shipment.id))).toEqual(["assignment", "status", "position"]);
      expect(stream2.about(sentinel1.id)).toEqual([]);
      // Unassigned shipments reach no driver, but the office sees everything.
      expect(stream1.about(unassigned.id)).toEqual([]);
      expect(stream2.about(unassigned.id)).toEqual([]);
      expect(reasons(office.about(shipment.id))).toEqual([
        "created",
        "assignment",
        "status",
        "position",
      ]);
      expect(reasons(office.about(unassigned.id))).toEqual(["created"]);
    });
  });
});
