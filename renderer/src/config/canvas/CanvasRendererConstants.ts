/** Maximum logical storage retained for derived LOD canvases per renderer. */
export const DERIVED_LOD_CACHE_BUDGET_BYTES = 128 * 1024 * 1024;

/** Maximum transient pixel storage used to assemble one minified frame. */
export const MAX_FRAME_SURFACE_BYTES = 128 * 1024 * 1024;

/** Conservative cross-browser limit for either offscreen canvas dimension. */
export const MAX_CANVAS_DIMENSION = 32_767;
