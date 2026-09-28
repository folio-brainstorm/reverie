/** Platform-independent rendering contracts for advanced renderers. */
export { RenderingCore } from "./RenderingCore.js";

export type { RenderSource } from "../../interfaces/renderer/RenderSource.js";
export type { RenderRequest } from "../../interfaces/renderer/RenderRequest.js";
export type { RenderRegion } from "../../interfaces/renderer/RenderRegion.js";
export type { RenderRegionSet } from "../../interfaces/renderer/RenderRegionSet.js";
export type { RenderContinuation } from "../../interfaces/renderer/RenderContinuation.js";
export type { RenderBudget } from "../../interfaces/renderer/RenderBudget.js";
export type { RenderContext } from "../../interfaces/renderer/RenderContext.js";
export type { RenderQualityMode } from "../../interfaces/renderer/RenderQualityMode.js";
export type { RenderDiagnostics } from "../../interfaces/renderer/RenderDiagnostics.js";
export type {
  RenderResultCacheDiagnostics,
} from "../../interfaces/renderer/RenderResultCacheDiagnostics.js";
export type {
  RenderingCoreDiagnosticsSnapshot,
} from "../../interfaces/renderer/RenderingCoreDiagnosticsSnapshot.js";
export type { TimingMetric } from "../../interfaces/renderer/TimingMetric.js";
export type {
  RenderLodRequest,
  RenderLodStrategy,
} from "../../interfaces/renderer/RenderLodStrategy.js";
export type { RenderingCoreConfig } from "../../interfaces/renderer/RenderingCoreConfig.js";
export type { TileCoord } from "../../interfaces/tile/TileCoord.js";
export type { Renderer } from "../../interfaces/renderer/Renderer.js";
export type { RendererBackend } from "../../interfaces/renderer/RendererBackend.js";
export type { RenderTarget } from "../../interfaces/renderer/RenderTarget.js";
