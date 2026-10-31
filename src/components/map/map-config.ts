/**
 * Map settings shared by every map, free of MapLibre itself so any module may import them.
 *
 * Basemap: OpenFreeMap's "positron" style (OpenStreetMap data, no API key, app traffic allowed;
 * decision 17). Positron is a pale, nearly colourless basemap made for overlaying data, so the
 * status colours of the markers (sky, indigo, red) are the only colour on the map. The colourful
 * "liberty" style paints parks green and water blue, which would compete with them.
 */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

/** Never zoom closer than a district when fitting markers, even for a single one. */
export const FIT_MAX_ZOOM = 12;

/** How long a marker glides to its new position. Pings are 10 s apart, so it rests most of the time. */
export const MARKER_EASE_MS = 800;
