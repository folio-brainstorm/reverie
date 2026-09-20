import type { Brush } from "../../interfaces/brush/Brush.js";
import type { PixelBrushConfig } from "../../interfaces/brush/PixelBrushConfig.js";
import type { ResolvedBrushParameters } from "../../interfaces/brush/ResolvedBrushParameters.js";
import type { NormalizedBrushDynamics } from "../../interfaces/brush/dynamics/NormalizedBrushDynamics.js";
import type { NormalizedBrushJitter } from "../../interfaces/brush/jitter/NormalizedBrushJitter.js";
import type { NormalizedBrushScatter } from "../../interfaces/brush/scatter/NormalizedBrushScatter.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { RGBAColor } from "../../interfaces/color/Colors.js";
import type { PaintMode } from "../../interfaces/paint/PaintMode.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";
import type { Raster } from "../raster/Raster.js";

import { writeRasterStampPixel } from "../../internal/raster-write/WriteRasterStampPixel.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { isValidRGBAColor } from "../../utils/number/color/IsValidRGBAColor.js";
import { isPositiveFiniteNumber } from "../../utils/number/math/IsPositiveFiniteNumber.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";
import { assertUint32 } from "../../utils/number/math/AssertUint32.js";
import { resolvePaintMode } from "../paint/ResolvePaintMode.js";
import { normalizeBrushDynamics } from "./NormalizeBrushDynamics.js";
import { normalizeBrushJitter } from "./NormalizeBrushJitter.js";
import { normalizeBrushScatter } from "./NormalizeBrushScatter.js";
import { resolveBrushDynamics } from "./ResolveBrushDynamics.js";
import { resolveBrushJitter } from "./ResolveBrushJitter.js";
import { resolveBrushScatter } from "./ResolveBrushScatter.js";
import { resolveBrushStampDistance } from "./ResolveBrushStampDistance.js";

const DEFAULT_BRUSH_SPACING = 0.25;

/**
 * Models a square hard-edged brush whose footprint aligns to the pixel grid.
 *
 * Odd footprint sizes snap around one pixel center. Even sizes snap around one
 * pixel intersection. Every covered pixel receives binary coverage `1`, so a
 * one-pixel opaque stamp writes exactly one fully opaque pixel.
 */
export class PixelBrush implements Brush {
  /** Positive safe-integer footprint width and height in world pixels. */
  readonly size: number;

  /** Stamp opacity in the inclusive range from zero to one. */
  readonly opacity: number;

  /** Distance between stamps expressed as a proportion of {@link size}. */
  readonly spacing: number;

  /** Stable uint32 base seed for stroke derivation and direct stamps. */
  readonly seed: number;

  /** Internally owned color so later config mutations cannot alter the brush. */
  private readonly internalColor: RGBAColor;

  /** Validated size and opacity dynamics, or `null` when disabled. */
  private readonly dynamics: NormalizedBrushDynamics | null;

  /** Validated deterministic size, opacity, and spacing variation. */
  private readonly jitter: NormalizedBrushJitter | null;

  /** Validated optional position variation applied before grid snapping. */
  private readonly scatter: NormalizedBrushScatter | null;

  /** Whether a stamp must resolve parameters or its final position. */
  private readonly hasPaintVariation: boolean;

  /** Returns a copy of the straight-alpha RGBA8 stamp color. */
  get color(): RGBAColor {
    return { ...this.internalColor };
  }

  /**
   * Creates an axis-aligned hard-edged pixel brush.
   *
   * @param config - Integer footprint, paint parameters, variation, and seed.
   * @throws {ReverieRangeError} Size is not a positive safe integer, opacity
   * or spacing is invalid, color is not RGBA8, variation is malformed, or the
   * seed is outside the uint32 range.
   */
  constructor(config: PixelBrushConfig) {
    const {
      size,
      color,
      opacity = 1,
      spacing = DEFAULT_BRUSH_SPACING,
      seed = 0,
    } = config;

    if (!Number.isSafeInteger(size) || size <= 0) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_PIXEL_SIZE);
    }

    if (!isUnitInterval(opacity)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_OPACITY);
    }

    if (!isPositiveFiniteNumber(spacing)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_SPACING);
    }

    if (!isValidRGBAColor(color)) {
      throw ReverieRangeError.from(ErrorDefinitions.COMMON.INVALID_RGBA_COLOR);
    }

    assertUint32(seed, "brush.seed");

    this.size = size;
    this.opacity = opacity;
    this.spacing = spacing;
    this.seed = seed >>> 0;
    this.internalColor = { ...color };
    this.dynamics = normalizeBrushDynamics(config.dynamics);
    this.jitter = normalizeBrushJitter(config.jitter);
    this.scatter = normalizeBrushScatter(config.scatter);
    this.hasPaintVariation =
      this.jitter !== null ||
      this.scatter !== null ||
      (this.dynamics !== null &&
        (this.dynamics.size.pressure !== null ||
          this.dynamics.size.velocity !== null ||
          this.dynamics.opacity.pressure !== null ||
          this.dynamics.opacity.velocity !== null));
  }

  /**
   * Resolves dynamics and deterministic jitter for one actual stamp.
   *
   * The returned size remains continuous for shared dynamics semantics and is
   * rounded to the nearest positive integer only when rasterizing a footprint.
   *
   * @param input - Optional dynamics and deterministic random context.
   * @returns Independent size and opacity values with rotation fixed at zero.
   * @throws {ReverieRangeError} Used input, curve output, identity, or jitter
   * arithmetic is invalid.
   */
  resolveParameters(input?: StampCommand): ResolvedBrushParameters {
    return resolveBrushJitter(
      resolveBrushDynamics(this.size, this.opacity, 0, this.dynamics, input),
      this.jitter,
      this.seed,
      input,
    );
  }

  /**
   * Resolves the world-space distance from one stamp to its successor.
   *
   * @param input - Input and deterministic identity for the outgoing interval.
   * @returns A finite positive world-space interval.
   */
  resolveStampDistance(input: StampCommand): number {
    return resolveBrushStampDistance(
      this.resolveParameters(input).size,
      this.size,
      this.spacing,
      this.jitter,
      input.strokeSeed === undefined ? this.seed : input.strokeSeed,
      input,
    );
  }

  /**
   * Snaps and paints one hard-edged square footprint.
   *
   * @param raster - Sparse raster that receives the stamp.
   * @param position - Continuous position snapped according to footprint parity.
   * @param input - Optional dynamics, operation, and deterministic random context.
   * @throws {ReverieTypeError} A position component is not a number.
   * @throws {ReverieRangeError} A position is not finite, resolved bounds are
   * unsafe, or used dynamics, jitter, scatter, or identity input is invalid.
   */
  stamp(raster: Raster, position: WorldPoint, input?: StampCommand): void {
    const paintMode = resolvePaintMode(input?.paintMode);
    PixelBrush.assertFinitePosition(position.x, "position.x");
    PixelBrush.assertFinitePosition(position.y, "position.y");

    if (!this.hasPaintVariation) {
      this.paintFootprint(raster, position, this.size, this.opacity, paintMode);
      return;
    }

    const resolved = this.resolveParameters(input);
    if (resolved.size <= 0 || resolved.opacity <= 0) {
      return;
    }

    const paintPosition = resolveBrushScatter(
      position,
      resolved,
      this.scatter,
      this.seed,
      input,
    );
    this.paintFootprint(
      raster,
      paintPosition,
      resolved.size,
      resolved.opacity,
      paintMode,
    );
  }

  /** Writes one resolved binary footprint through the trusted pixel path. */
  private paintFootprint(
    raster: Raster,
    position: WorldPoint,
    resolvedSize: number,
    opacity: number,
    paintMode: PaintMode,
  ): void {
    if (
      resolvedSize <= 0 ||
      opacity <= 0 ||
      (paintMode === "paint" && this.internalColor.a === 0)
    ) {
      return;
    }

    const footprintSize = PixelBrush.resolveFootprintSize(resolvedSize);
    const halfSize = Math.floor(footprintSize / 2);
    const isOddSize = footprintSize % 2 === 1;
    const horizontalAnchor = isOddSize
      ? Math.floor(position.x)
      : Math.floor(position.x + 0.5);
    const verticalAnchor = isOddSize
      ? Math.floor(position.y)
      : Math.floor(position.y + 0.5);
    const minX = horizontalAnchor - halfSize;
    const minY = verticalAnchor - halfSize;
    const maxX = minX + footprintSize - 1;
    const maxY = minY + footprintSize - 1;

    if (![minX, minY, maxX, maxY].every(Number.isSafeInteger)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.BRUSH.UNSAFE_PIXEL_STAMP_BOUNDS,
      );
    }

    const effectiveAlpha = Math.round(this.internalColor.a * opacity);
    const normalizedEffectiveAlpha = effectiveAlpha / 255;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        writeRasterStampPixel(
          raster,
          x,
          y,
          paintMode,
          this.internalColor.r,
          this.internalColor.g,
          this.internalColor.b,
          effectiveAlpha,
          normalizedEffectiveAlpha,
          opacity,
        );
      }
    }
  }

  /** Converts a positive continuous dynamics result into a pixel footprint. */
  private static resolveFootprintSize(resolvedSize: number): number {
    const footprintSize = Math.max(1, Math.round(resolvedSize));
    if (!Number.isSafeInteger(footprintSize)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.BRUSH.UNSAFE_PIXEL_STAMP_BOUNDS,
      );
    }
    return footprintSize;
  }

  /** Rejects malformed continuous positions at the public stamp boundary. */
  private static assertFinitePosition(
    value: unknown,
    parameterName: string,
  ): asserts value is number {
    if (typeof value !== "number") {
      throw ReverieTypeError.from(
        ErrorDefinitions.BRUSH.INVALID_PIXEL_STAMP_POSITION_TYPE,
        { param: parameterName, received: typeof value },
      );
    }
    if (!Number.isFinite(value)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.BRUSH.INVALID_PIXEL_STAMP_POSITION,
        { param: parameterName, received: value },
      );
    }
  }
}
