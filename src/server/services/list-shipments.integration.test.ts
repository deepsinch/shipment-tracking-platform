import { beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";
import type { Shipment } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { listShipments, MAX_PAGE_SIZE, type ListShipmentsQuery } from "./list-shipments";

describe("listShipments", () => {
  let dispatcher: AuthContext;
  /** Five shipments, oldest first, with distinct creation times. */
  let own: Shipment[];
  let otherOrgShipment: Shipment;

  beforeAll(async () => {
    const orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    const base = Date.parse("2026-01-01T00:00:00Z");
    const specs = [
      { status: "created", reference: "PO-ALPHA-1" },
      { status: "in_transit", reference: "po-beta-2" },
      { status: "in_transit", reference: "100%_literal" },
      { status: "delivered", reference: null },
      { status: "created", reference: "PO-GAMMA-3" },
    ] as const;
    own = [];
    for (const [i, spec] of specs.entries()) {
      own.push(
        await createTestShipment(orgId, dispatcher.userId, {
          ...spec,
          createdAt: new Date(base + i * 60_000),
        }),
      );
    }

    const otherOrg = await createTestOrganization("Other Org");
    const outsider = await createTestContext(otherOrg.id, "admin");
    // Same reference as one of ours, to prove search does not cross organizations either.
    otherOrgShipment = await createTestShipment(otherOrg.id, outsider.userId, {
      reference: "PO-ALPHA-1",
    });
  });

  const list = async (query: ListShipmentsQuery = {}) => {
    const result = await listShipments(dispatcher, query);
    if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result)}`);
    return result;
  };
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
  /** Our shipments, newest first, filtered. */
  const expected = (keep: (s: Shipment) => boolean = () => true) => ids(own.filter(keep).reverse());

  it("returns only the caller's organization, newest first, with the total", async () => {
    const result = await list();

    expect(ids(result.rows)).toEqual(expected());
    expect(ids(result.rows)).not.toContain(otherOrgShipment.id);
    expect(result).toMatchObject({ total: 5, page: 1, pageSize: 20 });
  });

  it("filters by status", async () => {
    const result = await list({ status: "in_transit" });

    expect(ids(result.rows)).toEqual(expected((s) => s.status === "in_transit"));
    expect(result.total).toBe(2);
  });

  it.each([
    ["canonical", (code: string) => code],
    ["lowercase", (code: string) => code.toLowerCase()],
    ["without dashes", (code: string) => code.replaceAll("-", "")],
    [
      "lowercase without dashes, padded",
      (code: string) => `  ${code.replaceAll("-", "").toLowerCase()} `,
    ],
  ])("finds a shipment by its tracking code (%s)", async (_label, format) => {
    const target = own[2]!;

    const result = await list({ search: format(target.trackingCode) });

    expect(ids(result.rows)).toEqual([target.id]);
    expect(result.total).toBe(1);
  });

  it("finds shipments by part of the reference, case-insensitively", async () => {
    const result = await list({ search: "PO-" });

    expect(ids(result.rows)).toEqual(
      expected((s) => s.reference?.toLowerCase().startsWith("po-") ?? false),
    );
    expect(result.total).toBe(3);
  });

  it("matches LIKE wildcards in the search literally", async () => {
    const percent = await list({ search: "%" });
    const underscore = await list({ search: "0%_" });

    expect(ids(percent.rows)).toEqual([own[2]!.id]);
    expect(ids(underscore.rows)).toEqual([own[2]!.id]);
  });

  it("does not find another organization's shipment by its tracking code", async () => {
    const result = await list({ search: otherOrgShipment.trackingCode });

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("paginates with a stable order and the total across pages", async () => {
    const page1 = await list({ page: 1, pageSize: 2 });
    const page2 = await list({ page: "2", pageSize: "2" });
    const page3 = await list({ page: 3, pageSize: 2 });
    const beyond = await list({ page: 4, pageSize: 2 });

    expect([...ids(page1.rows), ...ids(page2.rows), ...ids(page3.rows)]).toEqual(expected());
    expect(ids(page3.rows)).toHaveLength(1);
    expect(beyond.rows).toEqual([]);
    for (const page of [page1, page2, page3, beyond]) expect(page.total).toBe(5);
  });

  it("combines the status filter with pagination totals", async () => {
    const result = await list({ status: "created", pageSize: 1 });

    expect(ids(result.rows)).toEqual([own[4]!.id]);
    expect(result.total).toBe(2);
  });

  it.each([
    ["page 0", { page: 0 }, "page"],
    ["a page size above the maximum", { pageSize: MAX_PAGE_SIZE + 1 }, "pageSize"],
    ["an unknown status", { status: "lost" }, "status"],
  ])("rejects %s", async (_label, query, field) => {
    const result = await listShipments(dispatcher, query);

    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.fieldErrors)).toEqual([field]);
  });

  describe("for drivers", () => {
    it("lists only shipments assigned to them", async () => {
      const driver = await createTestContext(dispatcher.organizationId, "driver");
      const assigned = await createTestShipment(dispatcher.organizationId, dispatcher.userId, {
        assignedDriverId: driver.userId,
      });

      const result = await listShipments(driver);

      expect(result.ok && ids(result.rows)).toEqual([assigned.id]);
      expect(result.ok && result.total).toBe(1);
    });
  });
});
