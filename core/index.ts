// Runtime engine API.
export { Raster } from "./src/core/raster/index.js";
export { SelectionMask } from "./src/core/selection/index.js";
export { RasterLayer, World, isLayerBlendMode } from "./src/core/world/index.js";
export { LAYER_BLEND_MODES } from "./src/config/world/LayerBlendModes.js";
export { Camera } from "./src/core/camera/index.js";
export {
  BrushImage,
  CircleBrush,
  ImageBrush,
  LinearDynamicsCurve,
  PixelBrush,
} from "./src/core/brush/index.js";
export { Rasterizers } from "./src/core/rasterizer/index.js";
export { Stroke } from "./src/core/stroke/index.js";
export {
  blendSourceOver,
  paintPixel,
  resolvePaintMode,
} from "./src/core/paint/index.js";
export { PAINT_MODES } from "./src/config/paint/PaintModes.js";
export { deriveStrokeSeed } from "./src/utils/random/DeriveStrokeSeed.js";
export { sampleStampRandom } from "./src/utils/random/SampleStampRandom.js";
export { STAMP_RANDOM_CHANNELS } from "./src/config/random/StampRandomChannels.js";
// #if DEBUG
export { Tile } from "./src/core/tile/index.js";
// #endif

// Shared normalized stroke-input defaults reused by input adapters.
export {
  DEFAULT_PRESSURE,
  DEFAULT_TILT_X,
  DEFAULT_TILT_Y,
} from "./src/config/stroke/StrokeInputConstants.js";

// Stable diagnostics and errors intended for consumer-side handling.
export { ErrorCodes } from "./src/utils/errors/ErrorDefinitions.js";
export {
  createReverieErrorBase,
  ReverieError,
  ReverieRangeError,
  ReverieTypeError,
} from "./src/utils/errors/ReverieErrors.js";
export { DiagnosticCodes } from "./src/utils/diagnostic/DiagnosticDefinitions.js";

// Public compile-time contracts.
export type {
  ErrorCode,
  ErrorCodeCatalog,
  ErrorDefinition,
} from "./src/interfaces/errors/ErrorDefinition.js";
export type {
  CodedError,
  NativeErrorConstructor,
  ReverieErrorBaseConstructor,
  ReverieErrorConstructor,
  TemplateArguments,
} from "./src/interfaces/errors/ReverieError.js";
export type { CameraConfig } from "./src/interfaces/camera/CameraConfig.js";
export type { Brush } from "./src/interfaces/brush/Brush.js";
export type { BrushAnchor } from "./src/interfaces/brush/BrushAnchor.js";
export type { BrushImageConfig } from "./src/interfaces/brush/BrushImageConfig.js";
export type { CircleBrushConfig } from "./src/interfaces/brush/CircleBrushConfig.js";
export type { ImageBrushConfig } from "./src/interfaces/brush/ImageBrushConfig.js";
export type { PixelBrushConfig } from "./src/interfaces/brush/PixelBrushConfig.js";
export type { RGBABrushImageSource } from "./src/interfaces/brush/RGBABrushImageSource.js";
export type { ResolvedBrushParameters } from "./src/interfaces/brush/ResolvedBrushParameters.js";
export type { BrushDynamics } from "./src/interfaces/brush/dynamics/BrushDynamics.js";
export type { BrushJitter } from "./src/interfaces/brush/jitter/BrushJitter.js";
export type { PixelBrushJitter } from "./src/interfaces/brush/jitter/PixelBrushJitter.js";
export type { BrushScatter } from "./src/interfaces/brush/scatter/BrushScatter.js";
export type { BrushParameterDynamics } from "./src/interfaces/brush/dynamics/BrushParameterDynamics.js";
export type { PixelBrushDynamics } from "./src/interfaces/brush/dynamics/PixelBrushDynamics.js";
export type { DirectionDynamics } from "./src/interfaces/brush/dynamics/DirectionDynamics.js";
export type { DynamicsCurve } from "./src/interfaces/brush/dynamics/DynamicsCurve.js";
export type { PressureDynamics } from "./src/interfaces/brush/dynamics/PressureDynamics.js";
export type { RotationDynamics } from "./src/interfaces/brush/dynamics/RotationDynamics.js";
export type { TiltDynamics } from "./src/interfaces/brush/dynamics/TiltDynamics.js";
export type { VelocityDynamics } from "./src/interfaces/brush/dynamics/VelocityDynamics.js";
export type { ScreenPoint } from "./src/interfaces/camera/ScreenPoint.js";
export type { ViewportSize } from "./src/interfaces/camera/ViewportSize.js";
export type { WorldPoint } from "./src/interfaces/camera/WorldPoint.js";
export type { WorldRect } from "./src/interfaces/camera/WorldRect.js";
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticReporter,
  DiagnosticSeverity,
} from "./src/interfaces/diagnostic/Diagnostic.js";
export type { WorldConfig } from "./src/interfaces/world/World.js";
export type { WorldBounds } from "./src/interfaces/world/WorldBounds.js";
export type { LayerBlendMode } from "./src/interfaces/world/LayerBlendMode.js";
export type { LayerRemovalObserver } from "./src/interfaces/world/LayerRemovalObserver.js";
export type { RasterLayerMutation } from "./src/interfaces/world/RasterLayerMutation.js";
export type { RasterLayerMutationObserver } from "./src/interfaces/world/RasterLayerMutationObserver.js";
export type { WorldMutation } from "./src/interfaces/world/WorldMutation.js";
export type { WorldMutationObserver } from "./src/interfaces/world/WorldMutationObserver.js";
export type { RasterConfig } from "./src/interfaces/raster/Raster.js";
export type { RasterStatistics } from "./src/interfaces/raster/RasterStatistics.js";
export type { TileBounds } from "./src/interfaces/tile/TileBounds.js";
export type { RasterLayerStatistics } from "./src/interfaces/world/RasterLayerStatistics.js";
export type { WorldRasterStatistics } from "./src/interfaces/world/WorldRasterStatistics.js";
export type { SelectionMaskConfig } from "./src/interfaces/selection/SelectionMaskConfig.js";
export type { RGBAColor } from "./src/interfaces/color/Colors.js";
export type { LocalPixelCoord } from "./src/interfaces/pixel/LocalPixelCoord.js";
export type { PixelCoord } from "./src/interfaces/pixel/PixelCoords.js";
export type { PixelCoverage } from "./src/interfaces/pixel/PixelCoverage.js";
export type { PaintStyle } from "./src/interfaces/paint/PaintStyle.js";
export type { PaintMode } from "./src/interfaces/paint/PaintMode.js";
export type { StampCommand } from "./src/interfaces/stroke/StampCommand.js";
export type { StrokeConfig } from "./src/interfaces/stroke/StrokeConfig.js";
export type { StrokeSample } from "./src/interfaces/stroke/StrokeSample.js";
export type { StrokeSampleInput } from "./src/interfaces/stroke/StrokeSampleInput.js";
export type {
  Circle,
  PixelCoverageVisitor,
} from "./src/interfaces/rasterizers/Rasterizers.js";
export type { Rect } from "./src/interfaces/pixel/Rect.js";
export type { TileConfig } from "./src/interfaces/tile/Tile.js";
export type { Renderer } from "./src/interfaces/renderer/Renderer.js";
export type { RendererBackend } from "./src/interfaces/renderer/RendererBackend.js";
export type { RenderTarget } from "./src/interfaces/renderer/RenderTarget.js";
export type { RenderContext } from "./src/interfaces/renderer/RenderContext.js";
export type { RenderQualityMode } from "./src/interfaces/renderer/RenderQualityMode.js";
export type { RenderRequest } from "./src/interfaces/renderer/RenderRequest.js";
export type { RenderRegion } from "./src/interfaces/renderer/RenderRegion.js";
export type { RenderRegionSet } from "./src/interfaces/renderer/RenderRegionSet.js";
