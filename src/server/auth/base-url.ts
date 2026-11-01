/**
 * Where the app is reachable, for Better Auth's `baseURL` and `trustedOrigins`. Pure (reads only
 * the record it is given), so every environment is unit tested without touching `process.env`.
 *
 * Better Auth needs the app's public origin (cookies, redirects, origin checks). Locally and on a
 * custom domain the owner sets `BETTER_AUTH_URL`. On Vercel every deployment has its own URL, so
 * asking for one variable per preview would never work; Vercel's system variables name the right
 * host instead (they hold a host without a scheme, always served over HTTPS):
 *
 *   production  https://$VERCEL_PROJECT_PRODUCTION_URL  (the project's shortest production domain)
 *   preview     https://$VERCEL_BRANCH_URL              (stable per branch), else $VERCEL_URL
 *
 * An explicit `BETTER_AUTH_URL` always wins, so a custom domain only needs that one variable.
 */

export type AuthUrlSource = {
  BETTER_AUTH_URL?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_URL?: string;
};

export type AuthUrls = {
  /** Better Auth's `baseURL`: no trailing slash. */
  url: string;
  /**
   * Every origin this deployment answers on, `url`'s first. On Vercel the same deployment is also
   * served on its unique, branch and production hosts; all of them are this app, so a form posted
   * from any of them is not cross-site.
   */
  trustedOrigins: string[];
};

export type AuthUrlResolution = ({ ok: true } & AuthUrls) | { ok: false; message: string };

const blank = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** `waybill-git-x.vercel.app` or `https://waybill-git-x.vercel.app/` to its origin, else null. */
function originOfHost(value: string | undefined): string | null {
  const host = blank(value);
  if (!host) return null;
  const candidate = /^https?:\/\//.test(host) ? host : `https://${host}`;
  return URL.canParse(candidate) ? new URL(candidate).origin : null;
}

export function resolveAuthUrls(source: AuthUrlSource): AuthUrlResolution {
  const onVercel = blank(source.VERCEL) === "1" || blank(source.VERCEL_ENV) !== undefined;
  const vercelOrigins = onVercel
    ? [
        originOfHost(source.VERCEL_PROJECT_PRODUCTION_URL),
        originOfHost(source.VERCEL_BRANCH_URL),
        originOfHost(source.VERCEL_URL),
      ].filter((origin) => origin !== null)
    : [];

  let base: string | null = null;
  const explicit = blank(source.BETTER_AUTH_URL);
  if (explicit) {
    base = explicit.replace(/\/+$/, "");
  } else if (onVercel) {
    const vercelEnv = blank(source.VERCEL_ENV);
    if (vercelEnv === "production") {
      base = originOfHost(source.VERCEL_PROJECT_PRODUCTION_URL) ?? originOfHost(source.VERCEL_URL);
    } else if (vercelEnv === "preview") {
      base = originOfHost(source.VERCEL_BRANCH_URL) ?? originOfHost(source.VERCEL_URL);
    }
    // `vercel dev` (VERCEL_ENV=development) serves on localhost: nothing to derive.
  }

  if (!base) {
    return {
      ok: false,
      message: onVercel
        ? "is required here (on Vercel it is derived for production and preview deployments " +
          "only; set it to the app's public origin, e.g. https://waybill.example)"
        : "is required (it is only derived automatically on Vercel): the app's public origin, " +
          "e.g. http://localhost:3000",
    };
  }
  // An explicit URL may carry a base path; trusted origins are origins only.
  const baseOrigin = URL.canParse(base) ? new URL(base).origin : base;
  return { ok: true, url: base, trustedOrigins: [...new Set([baseOrigin, ...vercelOrigins])] };
}
