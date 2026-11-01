/**
 * HTTP security headers for every response, applied by `headers()` in `next.config.ts`.
 * Pure (no Next or Node APIs) so the policy is unit tested and the config can import it.
 *
 * Content-Security-Policy, and why scripts allow `'unsafe-inline'` (decision 40):
 * Next streams the React Server Components payload as inline `<script>` tags, and with Cache
 * Components the static shell of each page is prerendered at build time. A per-request nonce
 * would force every page to render dynamically (Next's CSP guide: partial prerendering is
 * incompatible with nonces), and hashes cannot cover inline scripts whose content differs per
 * page and per request. So scripts are limited to this origin plus inline, while everything else
 * is locked down: no plugins, no `<base>` hijacking, forms post only here, no framing, and network
 * access only to this origin and the map tile server. XSS defence rests on React's escaping and on
 * never rendering raw HTML (`react/no-danger` is an ESLint error).
 */
import { MAP_STYLE_URL } from "../components/map/map-config";

/** OpenFreeMap serves the style, vector tiles, glyphs (fonts) and sprites from one origin. */
export const MAP_TILE_ORIGIN = new URL(MAP_STYLE_URL).origin;

export type SecurityHeaderOptions = {
  /** `next dev`: React needs `eval` for its debugging features (never in production). */
  dev: boolean;
};

export function contentSecurityPolicy({ dev }: SecurityHeaderOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Inline style attributes (React `style` props, MapLibre positioning markers and popups).
    "style-src": ["'self'", "'unsafe-inline'"],
    // MapLibre fetches the style, tiles, glyphs and sprites; `'self'` covers the SSE stream
    // (`/api/realtime`), Server Actions and, in development, the HMR websocket.
    "connect-src": ["'self'", MAP_TILE_ORIGIN],
    // MapLibre's tile worker is a bundled file under /_next/static (`setWorkerUrl` in
    // components/map/maplibre.ts), so no `blob:` worker is needed.
    "worker-src": ["'self'"],
    // MapLibre's stylesheet draws its control icons as data: SVG backgrounds. Sprites are
    // fetched (connect-src) and decoded in script, not loaded as images.
    "img-src": ["'self'", "data:"],
    // next/font self-hosts the Geist fonts; map glyphs are fetched (connect-src), not fonts.
    "font-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "manifest-src": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Permissions-Policy: geolocation for this origin only (the driver app shares the truck's
 * position); camera, microphone and the rest of what the app never uses are off everywhere.
 */
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(self), payment=(), usb=()";

export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(options) },
    // Tracking pages carry the code in their URL: other sites only ever see our origin.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // For browsers without CSP `frame-ancestors`.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  ];
}
