ALTER TABLE "shipment_events" DROP CONSTRAINT "shipment_events_shipment_id_shipments_id_fk";
--> statement-breakpoint
-- Hand-reordered: drizzle-kit emitted the FK before the unique constraint it references.
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_id_organization_id_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_org_fk" FOREIGN KEY ("shipment_id","organization_id") REFERENCES "public"."shipments"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_location_lat_range" CHECK ("shipment_events"."location_lat" IS NULL OR "shipment_events"."location_lat" BETWEEN -90 AND 90);--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_location_lng_range" CHECK ("shipment_events"."location_lng" IS NULL OR "shipment_events"."location_lng" BETWEEN -180 AND 180);--> statement-breakpoint
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_status_change_has_target" CHECK ("shipment_events"."type" <> 'status_changed' OR "shipment_events"."to_status" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_weight_kg_positive" CHECK ("shipments"."weight_kg" > 0);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_version_positive" CHECK ("shipments"."version" >= 1);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_lat_range" CHECK ("shipments"."origin_lat" IS NULL OR "shipments"."origin_lat" BETWEEN -90 AND 90);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_lng_range" CHECK ("shipments"."origin_lng" IS NULL OR "shipments"."origin_lng" BETWEEN -180 AND 180);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_lat_range" CHECK ("shipments"."destination_lat" IS NULL OR "shipments"."destination_lat" BETWEEN -90 AND 90);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_lng_range" CHECK ("shipments"."destination_lng" IS NULL OR "shipments"."destination_lng" BETWEEN -180 AND 180);--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_country_iso2" CHECK ("shipments"."origin_country" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_country_iso2" CHECK ("shipments"."destination_country" ~ '^[A-Z]{2}$');