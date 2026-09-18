import type { RenderSource } from "./RenderSource.js";

/** Fixed source references retaining each caller's precise Raster/World types. */
export interface RenderSourceSnapshot<Config extends RenderSource> {
  readonly raster: Config["raster"];
  readonly world: Config["world"];
}
