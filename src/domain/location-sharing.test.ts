import { describe, expect, it } from "vitest";

import { ROLES } from "./roles";
import { SHIPMENT_STATUSES } from "./shipment-status";
import { canRecordLocation, isLocationSharingStatus } from "./location-sharing";

describe("isLocationSharingStatus", () => {
  it("accepts pings only while the shipment is on the road", () => {
    // Restated on purpose: a change to the list should be a deliberate edit here too.
    const sharing = SHIPMENT_STATUSES.filter(isLocationSharingStatus);
    expect(sharing).toEqual(["picked_up", "in_transit", "out_for_delivery"]);
  });
});

describe("canRecordLocation", () => {
  it("lets only drivers record positions", () => {
    expect(ROLES.filter(canRecordLocation)).toEqual(["driver"]);
  });
});
