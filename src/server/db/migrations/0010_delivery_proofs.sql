CREATE TABLE "delivery_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"shipment_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"recipient_name" text NOT NULL,
	"signature" jsonb,
	"photo_key" text,
	"captured_by" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_proofs_shipment_id_unique" UNIQUE("shipment_id"),
	CONSTRAINT "delivery_proofs_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "delivery_proofs_recipient_name_valid" CHECK (btrim("delivery_proofs"."recipient_name") <> '' AND char_length("delivery_proofs"."recipient_name") <= 120),
	CONSTRAINT "delivery_proofs_signature_valid" CHECK ("delivery_proofs"."signature" IS NULL OR (jsonb_typeof("delivery_proofs"."signature") = 'object' AND octet_length("delivery_proofs"."signature"::text) <= 32768)),
	CONSTRAINT "delivery_proofs_photo_key_valid" CHECK ("delivery_proofs"."photo_key" IS NULL OR ("delivery_proofs"."photo_key" <> '' AND char_length("delivery_proofs"."photo_key") <= 300))
);
--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_captured_by_user_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_shipment_org_fk" FOREIGN KEY ("shipment_id","organization_id") REFERENCES "public"."shipments"("id","organization_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Proofs are evidence, like history: reject any change or removal at the database level (see
-- docs/architecture.md, "Proof of delivery"). INSERT is unaffected. TRUNCATE skips row-level
-- triggers, so it has its own statement-level trigger.
CREATE FUNCTION "delivery_proofs_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'delivery_proofs is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'A delivery proof cannot be changed or removed.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "delivery_proofs_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "delivery_proofs"
FOR EACH ROW EXECUTE FUNCTION "delivery_proofs_reject_mutation"();
--> statement-breakpoint
CREATE TRIGGER "delivery_proofs_no_truncate"
BEFORE TRUNCATE ON "delivery_proofs"
FOR EACH STATEMENT EXECUTE FUNCTION "delivery_proofs_reject_mutation"();
