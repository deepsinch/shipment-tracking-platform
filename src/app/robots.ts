import type { MetadataRoute } from "next";

/**
 * Only the public landing page is for search engines. The app's surfaces are disallowed: staff
 * and driver pages need a session anyway, auth pages have nothing to index, and tracking and unsubscribe pages
 * belong to a carrier's customers (each also sends `noindex`, since robots.txt only asks crawlers
 * not to fetch a URL; it does not keep a linked URL out of an index).
 *
 * Everything else stays allowed (rather than `Disallow: /` with `Allow: /$`) so crawlers can still
 * fetch the landing page's CSS, fonts and scripts under `/_next/`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/driver", "/track", "/unsubscribe", "/api", "/sign-in", "/sign-up"],
    },
  };
}
