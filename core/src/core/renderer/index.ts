/**
 * @deprecated
 * 
 * Renderer has changed its role during the recent refactor.
 *
 * For backward compatibility, renderer/index.ts remains as a barrel export
 * for all rendering modules and the Renderer Backend.
 *
 * This compatibility layer will be removed in the next breaking release,
 * where all exports will be migrated to rendering/index.ts.
 */

export * from "../rendering/index.js";
