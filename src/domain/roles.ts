/**
 * Organization member roles. Stored in Better Auth's `member.role` column.
 * See docs/architecture.md, "Users".
 */
export const ROLES = ["admin", "dispatcher", "driver"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  admin: "Admin",
  dispatcher: "Dispatcher",
  driver: "Driver",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
