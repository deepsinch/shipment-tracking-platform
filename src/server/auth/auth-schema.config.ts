/**
 * Schema-generation config for the Better Auth CLI (`pnpm auth:generate`).
 *
 * It uses the same shared options and plugins as the runtime instance in `auth.ts`, minus the
 * database adapter (so the CLI does not need a database). The CLI writes
 * `src/server/db/schema/auth.ts` from it, so the auth tables always match the installed Better Auth
 * version and the plugins the app really uses.
 */
import { betterAuth } from "better-auth";

import { organizationPlugin, sharedAuthOptions } from "./options";

export const auth = betterAuth({
  ...sharedAuthOptions,
  plugins: [organizationPlugin],
});
