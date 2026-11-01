import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { SIGNATURE_MAX_BYTES } from "@/domain/delivery-proof";

import {
  createTestOrganization,
  createTestShipment,
  createTestUser,
  pgErrorCode,
} from "../../../tests/integration/fixtures";
import { getDb } from "./client";
import { deliveryProofs, type Shipment } from "./schema";

const RESTRICT_VIOLATION = "23001";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

async function failureCode(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return pgErrorCode(error);
  }
  throw new Error("Expected the statement to be rejected, but it succeeded");
}

describe("delivery_proofs", () => {
  let orgId: string;
  let actorId: string;
  let shipment: Shipment;

  const proofRow = (overrides: Partial<typeof deliveryProofs.$inferInsert> = {}) => ({
    organizationId: orgId,
    shipmentId: shipment.id,
    eventId: randomUUID(),
    recipientName: "Ada Recipient",
    capturedBy: actorId,
    ...overrides,
  });
  const newShipment = () => createTestShipment(orgId, actorId);

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    actorId = (await createTestUser(orgId, "driver")).id;
    shipment = await newShipment();
  });

  it("stores a proof with and without signature and photo", async () => {
    const [named] = await getDb().insert(deliveryProofs).values(proofRow()).returning();
    expect(named).toMatchObject({ signature: null, photoKey: null });
    const other = await newShipment();
    const [full] = await getDb()
      .insert(deliveryProofs)
      .values(
        proofRow({
          shipmentId: other.id,
          signature: { aspect: 2, strokes: [[[0.1, 0.1]]] },
          photoKey: "delivery-proofs/o/s/x.jpg",
        }),
      )
      .returning();
    expect(full!.signature).toEqual({ aspect: 2, strokes: [[[0.1, 0.1]]] });
  });

  describe("is append-only", () => {
    let proofId: string;
    beforeAll(async () => {
      const other = await newShipment();
      const [row] = await getDb()
        .insert(deliveryProofs)
        .values(proofRow({ shipmentId: other.id }))
        .returning();
      proofId = row!.id;
    });
    const stored = async () => {
      const [row] = await getDb()
        .select()
        .from(deliveryProofs)
        .where(eq(deliveryProofs.id, proofId));
      return row;
    };

    it("rejects UPDATE and keeps the row", async () => {
      const code = await failureCode(() =>
        getDb()
          .update(deliveryProofs)
          .set({ recipientName: "Someone Else" })
          .where(eq(deliveryProofs.id, proofId)),
      );
      expect(code).toBe(RESTRICT_VIOLATION);
      expect((await stored())!.recipientName).toBe("Ada Recipient");
    });

    it("rejects DELETE and keeps the row", async () => {
      const code = await failureCode(() =>
        getDb().delete(deliveryProofs).where(eq(deliveryProofs.id, proofId)),
      );
      expect(code).toBe(RESTRICT_VIOLATION);
      expect(await stored()).toBeDefined();
    });

    it("rejects TRUNCATE, which bypasses row-level triggers", async () => {
      const code = await failureCode(() => getDb().execute(sql`TRUNCATE delivery_proofs`));
      expect(code).toBe(RESTRICT_VIOLATION);
      expect(await stored()).toBeDefined();
    });
  });

  it("allows one proof per shipment and per event", async () => {
    const other = await newShipment();
    const first = proofRow({ shipmentId: other.id });
    await getDb().insert(deliveryProofs).values(first);

    expect(
      await failureCode(() =>
        getDb()
          .insert(deliveryProofs)
          .values(proofRow({ shipmentId: other.id })),
      ),
    ).toBe(UNIQUE_VIOLATION);
    const another = await newShipment();
    expect(
      await failureCode(() =>
        getDb()
          .insert(deliveryProofs)
          .values(proofRow({ shipmentId: another.id, eventId: first.eventId })),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it("pins the proof to its shipment's organization", async () => {
    const otherOrg = await createTestOrganization();
    const other = await newShipment();
    const code = await failureCode(() =>
      getDb()
        .insert(deliveryProofs)
        .values(proofRow({ shipmentId: other.id, organizationId: otherOrg.id })),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("refuses a blank or overlong name, a signature that is not an object or is too big", async () => {
    const check = async (overrides: Partial<typeof deliveryProofs.$inferInsert>) =>
      failureCode(async () =>
        getDb()
          .insert(deliveryProofs)
          .values(proofRow({ shipmentId: (await newShipment()).id, ...overrides })),
      );

    expect(await check({ recipientName: "   " })).toBe(CHECK_VIOLATION);
    expect(await check({ recipientName: "x".repeat(121) })).toBe(CHECK_VIOLATION);
    expect(await check({ photoKey: "" })).toBe(CHECK_VIOLATION);
    expect(
      await check({ signature: [1, 2, 3] as unknown as { aspect: number; strokes: [] } }),
    ).toBe(CHECK_VIOLATION);
    expect(
      await check({
        signature: { aspect: 2, strokes: [], filler: "x".repeat(SIGNATURE_MAX_BYTES) } as never,
      }),
    ).toBe(CHECK_VIOLATION);
  });
});
