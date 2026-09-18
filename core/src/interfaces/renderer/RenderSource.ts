import type { Raster } from "../../core/raster/Raster.js";
import type { World } from "../../core/world/World.js";

/** Exactly one independent Raster or composed World used by a renderer. */
export type RenderSource =
  { raster: Raster; world?: never } | { world: World; raster?: never };
