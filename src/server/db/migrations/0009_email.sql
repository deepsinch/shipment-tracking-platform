CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"shipment_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"transport" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_status_known" CHECK ("email_messages"."status" IN ('pending', 'succeeded', 'failed', 'dead', 'suppressed')),
	CONSTRAINT "email_messages_transport_known" CHECK ("email_messages"."transport" IS NULL OR "email_messages"."transport" IN ('resend', 'preview')),
	CONSTRAINT "email_messages_next_attempt_matches_status" CHECK (("email_messages"."status" IN ('pending', 'failed')) = ("email_messages"."next_attempt_at" IS NOT NULL)),
	CONSTRAINT "email_messages_transport_matches_status" CHECK (("email_messages"."status" = 'succeeded') = ("email_messages"."transport" IS NOT NULL)),
	CONSTRAINT "email_messages_attempts_not_negative" CHECK ("email_messages"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "email_opt_outs" (
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"opted_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_opt_outs_organization_id_email_pk" PRIMARY KEY("organization_id","email"),
	CONSTRAINT "email_opt_outs_email_lowercase" CHECK ("email_opt_outs"."email" = lower("email_opt_outs"."email"))
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_shipment_org_fk" FOREIGN KEY ("shipment_id","organization_id") REFERENCES "public"."shipments"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_opt_outs" ADD CONSTRAINT "email_opt_outs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_idempotency_key_idx" ON "email_messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_messages_due_idx" ON "email_messages" USING btree ("next_attempt_at","id") WHERE "email_messages"."status" IN ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "email_messages_shipment_created_at_idx" ON "email_messages" USING btree ("shipment_id","created_at");--> statement-breakpoint
CREATE INDEX "email_messages_org_created_at_idx" ON "email_messages" USING btree ("organization_id","created_at");