import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db/client";

import type { RealtimeSignal } from "./bus";
import { REALTIME_CHANNEL, type RealtimeMessage } from "./messages";
import { PostgresRealtimeBus } from "./postgres-bus";

const connectionString = process.env.DATABASE_URL!;

/** A valid message about a random shipment, so each one is recognisable. */
const changed = (organizationId = randomUUID()): RealtimeMessage => ({
  kind: "shipment_changed",
  organizationId,
  shipmentId: randomUUID(),
  assignedDriverId: null,
  previousDriverId: null,
  reason: "status",
});

/** Records every signal a subscriber receives and waits for specific ones. */
function recorder() {
  const signals: RealtimeSignal[] = [];
  return {
    signals,
    listener: (signal: RealtimeSignal) => signals.push(signal),
    /** Resolves once a signal matching `predicate` has arrived. */
    async waitFor(predicate: (signal: RealtimeSignal) => boolean, what: string) {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (signals.some(predicate)) return;
        await sleep(25);
      }
      throw new Error(`Timed out waiting for ${what}; got ${JSON.stringify(signals)}`);
    },
  };
}

const isResync = (signal: RealtimeSignal) => signal.kind === "resync";
const isAbout = (message: RealtimeMessage) => (signal: RealtimeSignal) =>
  signal.kind === message.kind && signal.shipmentId === message.shipmentId;
const messagesIn = (signals: RealtimeSignal[]) =>
  signals.filter((signal) => signal.kind !== "resync");

async function listenerBackends(applicationName: string): Promise<number[]> {
  const { rows } = await getDb().$client.query<{ pid: number }>(
    `SELECT pid FROM pg_stat_activity WHERE application_name = $1`,
    [applicationName],
  );
  return rows.map((row) => row.pid);
}

describe("PostgresRealtimeBus", () => {
  const buses: PostgresRealtimeBus[] = [];
  const log = { warn: vi.fn(), error: vi.fn() };

  /** A bus with its own application name, so its listener connection can be found and killed. */
  function newBus(options: { idleTimeoutMs?: number } = {}) {
    const applicationName = `waybill-realtime-test-${randomUUID()}`;
    const bus = new PostgresRealtimeBus({
      connectionString,
      applicationName,
      reconnectDelayMs: { initial: 20, max: 100 },
      log,
      ...options,
    });
    buses.push(bus);
    return { bus, applicationName };
  }

  /** Subscribes and waits for the first resync, i.e. until LISTEN is active. */
  async function listening(bus: PostgresRealtimeBus) {
    const rec = recorder();
    const unsubscribe = bus.subscribe(rec.listener);
    await rec.waitFor(isResync, "the first resync");
    return { ...rec, unsubscribe };
  }

  afterEach(async () => {
    await Promise.all(buses.splice(0).map((bus) => bus.close()));
    log.warn.mockClear();
    log.error.mockClear();
  });

  it("delivers a message published in a committed transaction", async () => {
    const { bus } = newBus();
    const sub = await listening(bus);
    const message = changed();

    await getDb().transaction((tx) => bus.publish(tx, message));

    await sub.waitFor(isAbout(message), "the committed message");
    expect(messagesIn(sub.signals)).toEqual([message]);
  });

  it("delivers only on commit, not when the message is published", async () => {
    const { bus } = newBus();
    const sub = await listening(bus);
    const message = changed();

    await getDb().transaction(async (tx) => {
      await bus.publish(tx, message);
      // Still inside the transaction: nothing may have been delivered yet.
      await sleep(200);
      expect(messagesIn(sub.signals)).toEqual([]);
    });

    await sub.waitFor(isAbout(message), "the message after commit");
  });

  it("never delivers a message from a rolled-back transaction", async () => {
    const { bus } = newBus();
    const sub = await listening(bus);
    const rolledBack = changed();
    const sentinel = changed();

    await expect(
      getDb().transaction(async (tx) => {
        await bus.publish(tx, rolledBack);
        throw new Error("the write failed");
      }),
    ).rejects.toThrow("the write failed");
    // Notifications arrive in commit order, so once the sentinel is here the other would be too.
    await getDb().transaction((tx) => bus.publish(tx, sentinel));

    await sub.waitFor(isAbout(sentinel), "the sentinel");
    expect(messagesIn(sub.signals)).toEqual([sentinel]);
  });

  it("fans out every message to every subscriber over one connection", async () => {
    const { bus, applicationName } = newBus();
    const first = await listening(bus);
    const second = await listening(bus);
    const message = changed();

    await getDb().transaction((tx) => bus.publish(tx, message));

    await first.waitFor(isAbout(message), "the message (first subscriber)");
    await second.waitFor(isAbout(message), "the message (second subscriber)");
    expect(await listenerBackends(applicationName)).toHaveLength(1);
  });

  it("keeps delivering to the others when one subscriber throws", async () => {
    const { bus } = newBus();
    bus.subscribe((signal) => {
      if (signal.kind !== "resync") throw new Error("broken subscriber");
    });
    const healthy = await listening(bus);
    const message = changed();

    await getDb().transaction((tx) => bus.publish(tx, message));

    await healthy.waitFor(isAbout(message), "the message");
    expect(log.error).toHaveBeenCalledWith("[realtime] a subscriber threw", expect.any(Error));
  });

  it("drops malformed payloads with a log line and keeps listening", async () => {
    const { bus } = newBus();
    const sub = await listening(bus);
    const sentinel = changed();

    // Anyone with database access can NOTIFY this channel; only valid messages get through.
    const notify = (payload: string) =>
      getDb().execute(sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`);
    await notify("not json");
    await notify(JSON.stringify({ kind: "shipment_changed", organizationId: "org" }));
    await notify(JSON.stringify({ ...changed(), kind: "something_else" }));
    await notify(JSON.stringify({ ...changed(), shipmentId: "not-a-uuid" }));
    await getDb().transaction((tx) => bus.publish(tx, sentinel));

    await sub.waitFor(isAbout(sentinel), "the sentinel");
    expect(messagesIn(sub.signals)).toEqual([sentinel]);
    expect(log.warn).toHaveBeenCalledTimes(4);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("dropped a malformed message"));
  });

  it("refuses to publish an invalid message, failing the transaction", async () => {
    const { bus } = newBus();
    const invalid = { ...changed(), organizationId: "" };

    await expect(getDb().transaction((tx) => bus.publish(tx, invalid))).rejects.toThrow();
  });

  it("reconnects after its connection is killed and tells subscribers to resync", async () => {
    const { bus, applicationName } = newBus();
    const sub = await listening(bus);
    const [pid] = await listenerBackends(applicationName);
    expect(pid).toBeDefined();
    sub.signals.length = 0;

    await getDb().execute(sql`SELECT pg_terminate_backend(${pid})`);

    await sub.waitFor(isResync, "a resync after reconnecting");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("listener connection lost"));
    const backends = await listenerBackends(applicationName);
    expect(backends).toHaveLength(1);
    expect(backends[0]).not.toBe(pid);

    // And it listens again.
    const message = changed();
    await getDb().transaction((tx) => bus.publish(tx, message));
    await sub.waitFor(isAbout(message), "a message after reconnecting");
  });

  it("closes its connection once the last subscriber has been gone for the idle timeout", async () => {
    const { bus, applicationName } = newBus({ idleTimeoutMs: 100 });
    const first = await listening(bus);
    const second = await listening(bus);

    first.unsubscribe();
    await sleep(300);
    expect(await listenerBackends(applicationName)).toHaveLength(1);

    second.unsubscribe();
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await listenerBackends(applicationName)).length === 0) break;
      await sleep(25);
    }
    expect(await listenerBackends(applicationName)).toHaveLength(0);

    // A new subscriber connects again.
    await listening(bus);
    expect(await listenerBackends(applicationName)).toHaveLength(1);
  });

  it("stops delivering to a subscriber that unsubscribed", async () => {
    const { bus } = newBus();
    const leaving = await listening(bus);
    const staying = await listening(bus);
    leaving.unsubscribe();
    const message = changed();

    await getDb().transaction((tx) => bus.publish(tx, message));

    await staying.waitFor(isAbout(message), "the message");
    expect(messagesIn(leaving.signals)).toEqual([]);
  });
});
