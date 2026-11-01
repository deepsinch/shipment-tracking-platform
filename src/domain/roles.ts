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

/**
 * The role of a request authenticated with an API key. Not a member role: no user is ever a member
 * of an organization as `api` (it is not in `ROLES`, so `isRole("api")` is false, and Better Auth
 * is never told about it). It exists only inside an `AuthContext`, so the permission rules can
 * treat an integration like any other caller. See docs/architecture.md, decision 53.
 */
export const API_ROLE = "api" as const;

/** Every role an `AuthContext` can carry: a member's role, or `api` for an API key. */
export type ActorRole = Role | typeof API_ROLE;
