import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { API_SCOPES } from "@/domain/api-keys";

import { organization, user } from "./auth";

const SCOPE_ARRAY_LITERAL = `ARRAY[${API_SCOPES.map((scope) => `'${scope}'`).join(", ")}]::text[]`;

/**
 * API keys for the public API (docs/architecture.md, "Public API"). The secret is shown once, at
 * creation, and never stored: only its SHA-256 hash (what a request is looked up by) and a short
 * display prefix. Keys are revoked, never deleted, so the list keeps a record of what existed.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** The first characters of the key ("wb_live_AbCd"), to recognise it in the list. */
    prefix: text("prefix").notNull(),
    /** Hex SHA-256 of the whole key. Unique: authentication is a lookup by this index. */
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    /** Whom the key acts as in history: events made through the API are attributed to them. */
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    /** At most one write per minute (see `authenticateApiKey`). */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("api_keys_org_created_at_idx").on(table.organizationId, table.createdAt),
    check("api_keys_name_not_blank", sql`length(btrim(${table.name})) BETWEEN 1 AND 100`),
    check("api_keys_scopes_not_empty", sql`cardinality(${table.scopes}) >= 1`),
    // Literals, not parameters: a CHECK cannot take bind parameters. The scopes are constants.
    check("api_keys_scopes_known", sql`${table.scopes} <@ ${sql.raw(SCOPE_ARRAY_LITERAL)}`),
  ],
);

export type ApiKeyRow = typeof apiKeys.$inferSelect;
