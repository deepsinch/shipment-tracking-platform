/**
 * Schema-generation config for the Better Auth CLI (`pnpm auth:generate`).
 *
 * It lists only the options that shape the database: email/password accounts and the organization
 * plugin. The CLI reads it to write `src/server/db/schema/auth.ts`, so the auth tables always match
 * the installed Better Auth version instead of being written by hand. Keep the plugin list in sync
 * with the runtime config in `src/server/auth/auth.ts`.
 */
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
  emailAndPassword: { enabled: true },
  plugins: [organization()],
});
