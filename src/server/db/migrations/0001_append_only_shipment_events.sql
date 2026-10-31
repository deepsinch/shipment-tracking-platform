-- shipment_events is an append-only audit trail (see docs/architecture.md, "Event history").
-- Reject any attempt to change or remove history at the database level, so it stays
-- tamper-evident even if application code has a bug. INSERT is unaffected.

CREATE FUNCTION "shipment_events_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'shipment_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation',
          HINT = 'Record a new event instead of changing history.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "shipment_events_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "shipment_events"
FOR EACH ROW EXECUTE FUNCTION "shipment_events_reject_mutation"();
--> statement-breakpoint
-- TRUNCATE skips row-level triggers, so it needs its own statement-level trigger.
CREATE TRIGGER "shipment_events_no_truncate"
BEFORE TRUNCATE ON "shipment_events"
FOR EACH STATEMENT EXECUTE FUNCTION "shipment_events_reject_mutation"();
