import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Shipment } from "@/server/db/schema";
import { createShipmentSchema } from "@/server/services/create-shipment";
import type { ShipmentEventWithActor } from "@/server/services/get-shipment";

import { openApiDocument } from "./openapi";
import {
  toApiEvent,
  toApiShipment,
  toApiShipmentDetail,
  toApiShipmentSummary,
  toApiTracking,
} from "./projections";
import { CHANGE_STATUS_FIELDS, CREATE_SHIPMENT_FIELDS } from "./request-fields";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const doc = JSON.parse(JSON.stringify(openApiDocument)) as Json;

const API_DIR = path.resolve(import.meta.dirname, "../../app/api/v1");
const METHODS = ["get", "post", "put", "patch", "delete"];

/** `shipments/[id]/status/route.ts` -> `{ path: "/shipments/{id}/status", methods: ["post"] }`. */
function routeFiles(dir = API_DIR, prefix = ""): { path: string; methods: string[] }[] {
  const found: { path: string; methods: string[] }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...routeFiles(full, `${prefix}/${entry.replace(/\[(\w+)\]/, "{$1}")}`));
    } else if (entry === "route.ts") {
      const source = readFileSync(full, "utf8");
      const methods = [
        ...source.matchAll(/export (?:const|function) (GET|POST|PUT|PATCH|DELETE)\b/g),
      ];
      found.push({ path: prefix, methods: methods.map((match) => match[1]!.toLowerCase()) });
    }
  }
  return found;
}

function resolve(node: Json): Json {
  if (typeof node.$ref !== "string") return node;
  const pointer = node.$ref.replace(/^#\//, "").split("/");
  return pointer.reduce<Json>((current, key) => current[key], doc);
}

/** The property names of an object schema, following `allOf` and `$ref`. */
function propertyNames(schema: Json): string[] {
  const resolved = resolve(schema);
  if (resolved.allOf) return resolved.allOf.flatMap(propertyNames).sort();
  return Object.keys(resolved.properties ?? {}).sort();
}

const schema = (name: string) => doc.components.schemas[name] as Json;
const keys = (value: object) => Object.keys(value).sort();

describe("OpenAPI document", () => {
  it("is OpenAPI 3.1 and survives a JSON round trip", () => {
    expect(doc.openapi).toMatch(/^3\.1\.\d+$/);
    expect(doc.info).toMatchObject({ title: expect.any(String), version: expect.any(String) });
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0);
  });

  it("describes every route handler, and only those (the document itself is excluded)", () => {
    const documented = Object.entries(doc.paths as Json)
      .flatMap(([route, item]) => Object.keys(item).map((method) => `${method} ${route}`))
      .sort();
    const implemented = routeFiles()
      .filter((route) => route.path !== "/openapi.json")
      .flatMap((route) => route.methods.map((method) => `${method} ${route.path}`))
      .sort();

    expect(implemented.length).toBeGreaterThan(0);
    expect(documented).toEqual(implemented);
  });

  it("gives every operation an id, a response, and the shared problem responses for errors", () => {
    const ids = new Set<string>();
    for (const [route, item] of Object.entries(doc.paths as Json)) {
      for (const method of Object.keys(item).filter((name) => METHODS.includes(name))) {
        const operation = item[method] as Json;
        expect(operation.operationId, `${method} ${route}`).toEqual(expect.any(String));
        expect(ids.has(operation.operationId), `duplicate ${operation.operationId}`).toBe(false);
        ids.add(operation.operationId);

        const statuses = Object.keys(operation.responses);
        expect(
          statuses.some((status) => status.startsWith("2")),
          `${method} ${route}`,
        ).toBe(true);
        for (const status of statuses.filter((status) => !status.startsWith("2"))) {
          const response = resolve(operation.responses[status]);
          expect(Object.keys(response.content), `${method} ${route} ${status}`).toEqual([
            "application/problem+json",
          ]);
        }
        // Every operation but public tracking needs the key, and can be refused (401).
        if (operation.security?.length === 0) expect(statuses).not.toContain("401");
        else expect(statuses).toContain("401");
        // Path parameters are all declared.
        for (const name of [...route.matchAll(/\{(\w+)\}/g)].map((match) => match[1])) {
          expect(
            operation.parameters.some((p: Json) => p.in === "path" && p.name === name),
            `${method} ${route} declares {${name}}`,
          ).toBe(true);
        }
      }
    }
  });

  it("resolves every $ref", () => {
    const refs: string[] = [];
    JSON.stringify(doc, (_key, value) => {
      if (value && typeof value === "object" && typeof value.$ref === "string")
        refs.push(value.$ref);
      return value;
    });
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      expect(ref).toMatch(/^#\//);
      expect(resolve({ $ref: ref }), ref).toBeDefined();
    }
  });

  it("requires If-Match on the status change", () => {
    const parameters = doc.paths["/shipments/{id}/status"].post.parameters as Json[];
    expect(parameters.find((p) => p.name === "If-Match")).toMatchObject({
      in: "header",
      required: true,
    });
    expect(Object.keys(doc.paths["/shipments/{id}/status"].post.responses)).toEqual(
      expect.arrayContaining(["412", "428"]),
    );
  });

  describe("schemas list exactly the keys the projections return", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const shipment = {
      id: "id",
      organizationId: "org",
      trackingCode: "WB-AAAA-AAAA",
      status: "created",
      reference: null,
      recipientName: "r",
      recipientEmail: null,
      originAddressLine: "a",
      originCity: "c",
      originPostalCode: null,
      originCountry: "NL",
      originLat: null,
      originLng: null,
      destinationAddressLine: "a",
      destinationCity: "c",
      destinationPostalCode: null,
      destinationCountry: "BE",
      destinationLat: null,
      destinationLng: null,
      weightKg: 1,
      serviceLevel: "standard",
      promisedDeliveryAt: null,
      assignedDriverId: "driver",
      version: 1,
      createdBy: "creator",
      createdAt: now,
      updatedAt: now,
    } satisfies Shipment;
    const event = {
      id: "e",
      organizationId: "org",
      shipmentId: "id",
      type: "status_changed",
      fromStatus: "created",
      toStatus: "picked_up",
      occurredAt: now,
      recordedAt: now,
      actorUserId: "actor",
      locationCity: "c",
      locationLat: 1,
      locationLng: 1,
      publicNote: null,
      internalNote: null,
      metadata: {},
      actorName: "Actor",
      assignment: { fromName: null, toName: null },
    } satisfies ShipmentEventWithActor;

    it("Shipment", () => {
      const projected = toApiShipment(shipment);
      expect(propertyNames(schema("Shipment"))).toEqual(keys(projected));
      for (const side of ["origin", "destination"] as const) {
        expect(propertyNames(schema("Shipment").properties[side])).toEqual(keys(projected[side]));
      }
      expect(propertyNames(schema("Shipment").properties.recipient)).toEqual(
        keys(projected.recipient),
      );
    });

    it("ShipmentSummary", () => {
      const projected = toApiShipmentSummary({ ...shipment, ...{} });
      expect(propertyNames(schema("ShipmentSummary"))).toEqual(keys(projected));
    });

    it("Event", () => {
      expect(propertyNames(schema("Event"))).toEqual(keys(toApiEvent(event)));
    });

    it("ShipmentDetail", () => {
      const projected = toApiShipmentDetail({
        shipment,
        assignedDriverName: "Dries",
        events: [event],
      });
      expect(propertyNames(schema("ShipmentDetail"))).toEqual(keys(projected));
    });

    it("Tracking", () => {
      const projected = toApiTracking({
        trackingCode: "WB-AAAA-AAAA",
        status: "created",
        origin: { city: "c", country: "NL" },
        destination: { city: "c", country: "BE" },
        promisedDeliveryAt: null,
        timeline: [
          { type: "created", status: "created", occurredAt: now, city: null, publicNote: null },
        ],
      });
      expect(propertyNames(schema("Tracking"))).toEqual(keys(projected));
      expect(propertyNames(schema("Tracking").properties.timeline.items)).toEqual(
        keys(projected.timeline[0]!),
      );
    });

    it("the request bodies", () => {
      expect(propertyNames(schema("CreateShipment"))).toEqual([...CREATE_SHIPMENT_FIELDS].sort());
      expect(propertyNames(schema("ChangeStatus"))).toEqual([...CHANGE_STATUS_FIELDS].sort());
      // Every required field of the document is a required field of the service's schema.
      for (const field of schema("CreateShipment").required as string[]) {
        const rejected = createShipmentSchema.safeParse({}).error!.issues.map((i) => i.path[0]);
        expect(rejected, field).toContain(field);
      }
    });
  });
});
