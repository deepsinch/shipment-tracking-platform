import type { BetterAuthOptions } from "better-auth";
import { organization } from "better-auth/plugins";

import { ac, roles } from "./access-control";

/**
 * Options shared by the runtime auth instance (`auth.ts`) and the schema-generation config
 * (`auth-schema.config.ts`). Everything that can change the database schema lives here, so the
 * generated tables cannot drift from what the app actually runs.
 */
export const organizationPlugin = organization({
  ac,
  roles,
  // The user who signs up becomes the admin of their new organization.
  creatorRole: "admin",
  // Organizations are only created by the sign-up flow (server-side), not by users directly.
  allowUserToCreateOrganization: false,
  // Shipment history references the organization and cannot be deleted (append-only events).
  disableOrganizationDeletion: true,
});

export const sharedAuthOptions = {
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Sign-up creates the organization first and then signs in, so the new session can pick up the
    // organization as its active one. See src/server/auth/sign-up.ts.
    autoSignIn: false,
  },
} satisfies BetterAuthOptions;
