import type { RenderSource } from "../../../interfaces/renderer/RenderSource.js";
import type { RenderSourceSnapshot } from "../../../interfaces/renderer/RenderSourceSnapshot.js";

/**
 * Captures an owned, shallow-frozen dependency snapshot with exactly one source.
 * Mutating the caller's config later cannot rebind the renderer's dependencies.
 * @param config - Dependencies containing one Raster or World.
 * @param createInvalidSourceError - Factory preserving the caller's coded error taxonomy.
 * @returns A fixed snapshot retaining the caller-specific dependency types.
 * @throws The factory's error when both sources or neither are supplied.
 */
export function resolveRenderSource<Config extends RenderSource>(
  config: Config,
  createInvalidSourceError: () => Error,
): RenderSourceSnapshot<Config> {
  const source = Object.freeze({
    raster: readSourceProperty(config, "raster"),
    world: readSourceProperty(config, "world"),
  });
  if ((source.raster === undefined) === (source.world === undefined)) {
    throw createInvalidSourceError();
  }
  return source;
}

/** Generic-key access preserves optional union member types without assertions. */
function readSourceProperty<
  Config extends RenderSource,
  Key extends keyof Config,
>(config: Config, key: Key): Config[Key] {
  return config[key];
}
