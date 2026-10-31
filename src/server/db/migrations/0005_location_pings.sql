CREATE TABLE "location_pings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"shipment_id" uuid NOT NULL,
	"driver_id" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" double precision NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_pings_lat_range" CHECK ("location_pings"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "location_pings_lng_range" CHECK ("location_pings"."lng" BETWEEN -180 AND 180),
	CONSTRAINT "location_pings_accuracy_non_negative" CHECK ("location_pings"."accuracy_m" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shipment_positions" (
	"shipment_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" double precision NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"driver_id" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shipment_positions_lat_range" CHECK ("shipment_positions"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "shipment_positions_lng_range" CHECK ("shipment_positions"."lng" BETWEEN -180 AND 180),
	CONSTRAINT "shipment_positions_accuracy_non_negative" CHECK ("shipment_positions"."accuracy_m" >= 0)
);
--> statement-breakpoint
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_driver_id_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_shipment_org_fk" FOREIGN KEY ("shipment_id","organization_id") REFERENCES "public"."shipments"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_positions" ADD CONSTRAINT "shipment_positions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_positions" ADD CONSTRAINT "shipment_positions_driver_id_user_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_positions" ADD CONSTRAINT "shipment_positions_shipment_org_fk" FOREIGN KEY ("shipment_id","organization_id") REFERENCES "public"."shipments"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "location_pings_shipment_recorded_at_idx" ON "location_pings" USING btree ("shipment_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
-- Hand-added. A recorded fix is never corrected, so UPDATE is rejected. Unlike shipment_events,
-- DELETE and TRUNCATE stay allowed: pings are telemetry with a 30-day retention, and the purge job
-- deletes old rows (see docs/architecture.md, "Location telemetry is not history").
CREATE FUNCTION "location_pings_reject_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'location_pings rows are immutable: UPDATE is not allowed'
    USING ERRCODE = 'restrict_violation',
          HINT = 'Insert a new ping instead; old pings are only ever deleted by retention.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "location_pings_no_update"
BEFORE UPDATE ON "location_pings"
FOR EACH ROW EXECUTE FUNCTION "location_pings_reject_update"();
