import type { Role } from "./roles";

/**
 * Where each role works. Staff run the office from the dashboard; drivers get the mobile driver
 * app. Used after sign-in and by each surface's guard, which sends anyone on the wrong surface to
 * their own home. See docs/architecture.md, "Driver app".
 */
export type HomePath = "/dashboard" | "/driver";

// A record (not a condition) so adding a role is a type error until its home is decided.
const HOME_PATHS: Readonly<Record<Role, HomePath>> = {
  admin: "/dashboard",
  dispatcher: "/dashboard",
  driver: "/driver",
};

export function homePathFor(role: Role): HomePath {
  return HOME_PATHS[role];
}
