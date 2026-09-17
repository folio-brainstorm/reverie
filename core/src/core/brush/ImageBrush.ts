import type { Brush } from "../../interfaces/brush/Brush.js";
import type { BrushAnchor } from "../../interfaces/brush/BrushAnchor.js";
import type { ImageBrushConfig } from "../../interfaces/brush/ImageBrushConfig.js";
import type { ResolvedBrushParameters } from "../../interfaces/brush/ResolvedBrushParameters.js";
import type { NormalizedBrushDynamics } from "../../interfaces/brush/dynamics/NormalizedBrushDynamics.js";
import type { NormalizedBrushJitter } from "../../interfaces/brush/jitter/NormalizedBrushJitter.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { RGBAColor } from "../../interfaces/color/Colors.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";
import type { Raster } from "../raster/Raster.js";

import { blendRasterPixelSourceOver } from "../../internal/raster-write/BlendRasterPixelSourceOver.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { isValidRGBAColor } from "../../utils/number/color/IsValidRGBAColor.js";
import { isPositiveFiniteNumber } from "../../utils/number/math/IsPositiveFiniteNumber.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";
import { assertUint32 } from "../../utils/number/math/AssertUint32.js";
import { BrushImage } from "./BrushImage.js";
import { normalizeBrushDynamics } from "./NormalizeBrushDynamics.js";
import { normalizeBrushJitter } from "./NormalizeBrushJitter.js";
import { resolveBrushDynamics } from "./ResolveBrushDynamics.js";
import { resolveBrushJitter } from "./ResolveBrushJitter.js";

const DEFAULT_BRUSH_SPACING = 0.25;
const DEFAULT_ANCHOR: BrushAnchor = Object.freeze({ x: 0.5, y: 0.5 });

/** Paints a transformed alpha-mask image using immutable brush parameters. */
export class ImageBrush implements Brush {
  /** Immutable source alpha mask reused by every stamp. */
  readonly image: BrushImage;

  /** World-space length of the source image's longest side. */
  readonly size: number;

  /** Stamp opacity in the inclusive range `[0, 1]`. */
  readonly opacity: number;

  /** Distance between stamps expressed as a proportion of {@link size}. */
  readonly spacing: number;

  /** Static rotation offset in radians. */
  readonly rotation: number;

  /** Stable uint32 base seed for stroke derivation and direct stamps. */
  readonly seed: number;

  /** Internally owned paint color, independent from source image RGB. */
  private readonly internalColor: RGBAColor;

  /** Internally owned normalized transform pivot. */
  private readonly internalAnchor: BrushAnchor;

  /** Validated optional per-stamp mappings shared with CircleBrush. */
  private readonly dynamics: NormalizedBrushDynamics | null;

  /** Validated optional variation applied after dynamics. */
  private readonly jitter: NormalizedBrushJitter | null;

  /** Returns a copy of the straight-alpha RGBA8 paint color. */
  get color(): RGBAColor {
    return { ...this.internalColor };
  }

  /** Returns a copy of the normalized image anchor. */
  get anchor(): BrushAnchor {
    return { ...this.internalAnchor };
  }

  /**
   * Creates an image brush with validated immutable paint and transform state.
   *
   * @param config - Source mask, base parameters, anchor, dynamics, seed, and jitter.
   * @throws {ReverieRangeError} The image, size, color, opacity, spacing,
   * anchor, rotation, dynamics, uint32 seed, or jitter configuration is invalid.
   */
  constructor(config: ImageBrushConfig) {
    const {
      image,
      size,
      color,
      opacity = 1,
      spacing = DEFAULT_BRUSH_SPACING,
      anchor = DEFAULT_ANCHOR,
      rotation = 0,
      seed = 0,
    } = config;

    if (!(image instanceof BrushImage)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_BRUSH_IMAGE);
    }

    if (!isPositiveFiniteNumber(size)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_SIZE);
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

    if (!isValidAnchor(anchor)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_IMAGE_ANCHOR);
    }

    if (typeof rotation !== "number" || !Number.isFinite(rotation)) {
      throw ReverieRangeError.from(ErrorDefinitions.BRUSH.INVALID_ROTATION);
    }

    assertUint32(seed, "brush.seed");

    this.image = image;
    this.size = size;
    this.opacity = opacity;
    this.spacing = spacing;
    this.rotation = rotation;
    this.seed = seed >>> 0;
    this.internalColor = { ...color };
    this.internalAnchor = { ...anchor };
    this.dynamics = normalizeBrushDynamics(config.dynamics);
    this.jitter = normalizeBrushJitter(config.jitter);
  }

  /**
   * Resolves dynamics, then deterministic jitter, for one actual stamp.
   *
   * @param input - Optional dynamics input with uint32 seed and stamp index;
   * omitted input uses neutral dynamics defaults, the brush seed, and index `0`.
   * @returns Independent size, opacity, and radian rotation values.
   * @throws {ReverieRangeError} Used input, identity, curve output, or jitter result
   * is invalid.
   */
  resolveParameters(input?: StampCommand): ResolvedBrushParameters {
    return resolveBrushJitter(
      resolveBrushDynamics(
        this.size,
        this.opacity,
        this.rotation,
        this.dynamics,
        input,
      ),
      this.jitter,
      this.seed,
      input,
    );
  }

  /**
   * Inverse-maps destination pixel centers into the alpha mask and paints them.
   *
   * @param raster - Sparse raster receiving the transformed stamp.
   * @param position - World-space position occupied by the configured anchor.
   * @param input - Optional dynamics and random context; absent random identity
   * uses the brush seed and stamp index `0` without invocation state.
   * @throws {ReverieRangeError} Used dynamics input, transformed position, or
   * destination bounds, random identity, or jitter arithmetic are invalid.
   */
  stamp(raster: Raster, position: WorldPoint, input?: StampCommand): void {
    if (
      !this.image.hasCoverage ||
      this.internalColor.a === 0 ||
      this.opacity === 0
    ) {
      return;
    }

    const resolved = this.resolveParameters(input);

    if (resolved.size <= 0 || resolved.opacity <= 0) {
      return;
    }

    assertFinitePositionComponent(position.x, "position.x");
    assertFinitePositionComponent(position.y, "position.y");
    this.paintTransformedImage(raster, position, resolved);
  }

  /** Visits only the conservative transformed bounds using scalar inverse math. */
  private paintTransformedImage(
    raster: Raster,
    position: WorldPoint,
    resolved: ResolvedBrushParameters,
  ): void {
    const longestSourceSide = Math.max(this.image.width, this.image.height);
    const scale = resolved.size / longestSourceSide;
    const inverseScale = 1 / scale;
    const cosine = Math.cos(resolved.rotation);
    const sine = Math.sin(resolved.rotation);
    const anchorX = this.internalAnchor.x * this.image.width;
    const anchorY = this.internalAnchor.y * this.image.height;
    const left = -anchorX * scale;
    const right = (this.image.width - anchorX) * scale;
    const top = -anchorY * scale;
    const bottom = (this.image.height - anchorY) * scale;
    const leftTopX = left * cosine - top * sine;
    const rightTopX = right * cosine - top * sine;
    const leftBottomX = left * cosine - bottom * sine;
    const rightBottomX = right * cosine - bottom * sine;
    const leftTopY = left * sine + top * cosine;
    const rightTopY = right * sine + top * cosine;
    const leftBottomY = left * sine + bottom * cosine;
    const rightBottomY = right * sine + bottom * cosine;
    const minimumWorldX =
      position.x + Math.min(leftTopX, rightTopX, leftBottomX, rightBottomX);
    const maximumWorldX =
      position.x + Math.max(leftTopX, rightTopX, leftBottomX, rightBottomX);
    const minimumWorldY =
      position.y + Math.min(leftTopY, rightTopY, leftBottomY, rightBottomY);
    const maximumWorldY =
      position.y + Math.max(leftTopY, rightTopY, leftBottomY, rightBottomY);
    const minimumPixelX = normalizeZero(Math.ceil(minimumWorldX - 0.5));
    const maximumPixelX = normalizeZero(Math.floor(maximumWorldX - 0.5));
    const minimumPixelY = normalizeZero(Math.ceil(minimumWorldY - 0.5));
    const maximumPixelY = normalizeZero(Math.floor(maximumWorldY - 0.5));

    assertSafePixelBounds(
      minimumPixelX,
      maximumPixelX,
      minimumPixelY,
      maximumPixelY,
    );

    for (let pixelY = minimumPixelY; pixelY <= maximumPixelY; pixelY += 1) {
      const relativeY = pixelY + 0.5 - position.y;

      for (let pixelX = minimumPixelX; pixelX <= maximumPixelX; pixelX += 1) {
        const relativeX = pixelX + 0.5 - position.x;
        const sourceX =
          (relativeX * cosine + relativeY * sine) * inverseScale + anchorX;
        const sourceY =
          (-relativeX * sine + relativeY * cosine) * inverseScale + anchorY;
        const coverage = this.image.sampleAlpha(sourceX, sourceY);

        if (coverage <= 0) {
          continue;
        }

        const effectiveAlpha = Math.round(
          this.internalColor.a * resolved.opacity * coverage,
        );

        if (effectiveAlpha === 0) {
          continue;
        }

        blendRasterPixelSourceOver(
          raster,
          pixelX,
          pixelY,
          this.internalColor.r,
          this.internalColor.g,
          this.internalColor.b,
          effectiveAlpha,
          effectiveAlpha / 255,
        );
      }
    }
  }
}

/** Determines whether an anchor is a finite normalized point. */
function isValidAnchor(anchor: unknown): anchor is BrushAnchor {
  return (
    typeof anchor === "object" &&
    anchor !== null &&
    "x" in anchor &&
    "y" in anchor &&
    isUnitInterval(anchor.x) &&
    isUnitInterval(anchor.y)
  );
}

/** Rejects a malformed continuous stamp-position component. */
function assertFinitePositionComponent(
  value: unknown,
  parameterName: "position.x" | "position.y",
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.INVALID_IMAGE_STAMP_POSITION,
      { param: parameterName, received: value },
    );
  }
}

/** Ensures transformed bounds can be traversed with safe integer increments. */
function assertSafePixelBounds(
  minimumX: number,
  maximumX: number,
  minimumY: number,
  maximumY: number,
): void {
  if (
    !Number.isSafeInteger(minimumX) ||
    !Number.isSafeInteger(maximumX) ||
    !Number.isSafeInteger(minimumY) ||
    !Number.isSafeInteger(maximumY)
  ) {
    throw ReverieRangeError.from(
      ErrorDefinitions.BRUSH.UNSAFE_IMAGE_STAMP_BOUNDS,
    );
  }
}

/** Prevents negative zero from leaking into trusted pixel coordinates. */
function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
