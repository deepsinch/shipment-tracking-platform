CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_status_code" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_status_known" CHECK ("webhook_deliveries"."status" IN ('pending', 'succeeded', 'failed', 'dead')),
	CONSTRAINT "webhook_deliveries_event_type_known" CHECK ("webhook_deliveries"."event_type" IN ('shipment.created', 'shipment.status_changed', 'shipment.driver_assigned')),
	CONSTRAINT "webhook_deliveries_attempts_not_negative" CHECK ("webhook_deliveries"."attempts" >= 0),
	CONSTRAINT "webhook_deliveries_next_attempt_matches_status" CHECK (("webhook_deliveries"."status" IN ('pending', 'failed')) = ("webhook_deliveries"."next_attempt_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "webhook_drain_state" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"event_types" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_id_organization_id_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "webhook_endpoints_url_length" CHECK (length("webhook_endpoints"."url") BETWEEN 1 AND 2000),
	CONSTRAINT "webhook_endpoints_event_types_not_empty" CHECK (cardinality("webhook_endpoints"."event_types") >= 1),
	CONSTRAINT "webhook_endpoints_event_types_known" CHECK ("webhook_endpoints"."event_types" <@ ARRAY['shipment.created', 'shipment.status_changed', 'shipment.driver_assigned']::text[]),
	CONSTRAINT "webhook_endpoints_disabled_reason_matches" CHECK (("webhook_endpoints"."enabled" AND "webhook_endpoints"."disabled_reason" IS NULL) OR (NOT "webhook_endpoints"."enabled" AND "webhook_endpoints"."disabled_reason" IS NOT NULL AND "webhook_endpoints"."disabled_reason" IN ('manual', 'repeated_failures')))
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_org_fk" FOREIGN KEY ("endpoint_id","organization_id") REFERENCES "public"."webhook_endpoints"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at","id") WHERE "webhook_deliveries"."status" IN ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_created_at_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_created_at_idx" ON "webhook_endpoints" USING btree ("organization_id","created_at");