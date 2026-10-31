/** Delivery service levels a shipment can be booked with. */
export const SERVICE_LEVELS = ["standard", "express", "same_day"] as const;

export type ServiceLevel = (typeof SERVICE_LEVELS)[number];

export const SERVICE_LEVEL_LABELS: Readonly<Record<ServiceLevel, string>> = {
  standard: "Standard",
  express: "Express",
  same_day: "Same day",
};
