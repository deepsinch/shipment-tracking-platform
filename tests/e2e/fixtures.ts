import { test as base, type BrowserContext } from "@playwright/test";

export { expect } from "@playwright/test";

const TILE_HOST = "https://tiles.openfreemap.org/";

/**
 * A valid MapLibre style with no sources: the map initialises, draws a plain background and
 * places its markers, and asks for nothing else (no tiles, fonts or sprites).
 */
const EMPTY_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#eef0f3" } }],
};

/**
 * `E2E_MAP_TILES=live pnpm test:e2e` lets maps load the real basemap, for a manual check (the CSP
 * spec against real tiles, screenshots of real maps). Never set in CI: specs must not depend on
 * the network.
 */
const LIVE_TILES = process.env.E2E_MAP_TILES === "live";

/**
 * Keeps tests off the network: the basemap style is answered with `EMPTY_STYLE` and anything else
 * from the tile server is refused. Tests assert on markers and data, never on rendered tiles.
 */
export async function blockMapTiles(context: BrowserContext): Promise<void> {
  if (LIVE_TILES) return;
  await context.route(`${TILE_HOST}**`, (route) => {
    if (route.request().url().startsWith(`${TILE_HOST}styles/`)) {
      return route.fulfill({ json: EMPTY_STYLE });
    }
    return route.abort("blockedbyclient");
  });
}

/**
 * Playwright's `test`, with the map tile server blocked for the default browser context. Contexts
 * a test creates itself (a driver's phone) call `blockMapTiles` if they open a map.
 */
export const test = base.extend({
  // Playwright's callback is conventionally named `use`, which React's hook lint mistakes for
  // React's `use`; a different name keeps the lint meaningful elsewhere.
  context: async ({ context }, provide) => {
    await blockMapTiles(context);
    await provide(context);
  },
});
