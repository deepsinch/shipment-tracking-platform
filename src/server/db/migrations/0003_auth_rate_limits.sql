CREATE TABLE "auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "auth_rate_limits_count_positive" CHECK ("auth_rate_limits"."count" >= 1)
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limits_window_start_idx" ON "auth_rate_limits" USING btree ("window_start");