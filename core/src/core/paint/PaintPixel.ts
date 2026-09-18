import type { PaintStyle } from "../../interfaces/paint/PaintStyle.js";
import type { PixelCoverage } from "../../interfaces/pixel/PixelCoverage.js";
import type { Raster } from "../raster/Raster.js";

import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { ReverieRangeError } from "../../utils/errors/ReverieErrors.js";
import { isValidRGBAColor } from "../../utils/number/color/IsValidRGBAColor.js";
import { isUnitInterval } from "../../utils/number/math/IsUnitInterval.js";
import { resolvePaintMode } from "./ResolvePaintMode.js";

/**
 * Paints one rasterizer hit by applying coverage and operation opacity to the
 * source alpha before either compositing it over the raster or reducing the
 * destination alpha in erase mode.
 *
 * Paint coverage and opacity affect only the source contribution; source RGB
 * channels remain unchanged. Erase strength is `opacity * coverage` and ignores
 * source color, including its alpha. Paint whose effective RGBA8 alpha rounds
 * to zero is ignored without allocating a destination tile.
 *
 * @param raster - Sparse raster that receives the composited pixel.
 * @param hit - World pixel and its coverage in the inclusive `0..1` range.
 * @param style - RGBA8 source color, operation, and optional opacity.
 * @throws {ReverieRangeError} The color is invalid, or coverage or opacity is
 * not a finite number in the inclusive range from zero to one.
 * @throws {ReverieTypeError} The paint mode is unsupported.
 * @example
 * paintPixel(
 *   raster,
 *   { pixel: { x: 10, y: 20 }, coverage: 0.5 },
 *   { color: { r: 255, g: 0, b: 0, a: 255 }, opacity: 0.5 },
 * );
 */
export function paintPixel(
  raster: Raster,
  hit: PixelCoverage,
  style: PaintStyle,
): void {
  if (!isValidRGBAColor(style.color)) {
    throw ReverieRangeError.from(ErrorDefinitions.COMMON.INVALID_RGBA_COLOR);
  }

  const opacity = style.opacity === undefined ? 1 : style.opacity;
  const mode = resolvePaintMode(style.mode);

  if (!isUnitInterval(opacity)) {
    throw ReverieRangeError.from(ErrorDefinitions.PAINT.INVALID_OPACITY);
  }

  if (!isUnitInterval(hit.coverage)) {
    throw ReverieRangeError.from(ErrorDefinitions.PAINT.INVALID_COVERAGE);
  }

  if (mode === "erase") {
    // Erase strength deliberately ignores source RGB and alpha.
    raster.erasePixel(hit.pixel, opacity * hit.coverage);
    return;
  }

  const effectiveAlpha = Math.round(style.color.a * opacity * hit.coverage);

  if (effectiveAlpha === 0) {
    return;
  }

  raster.blendPixel(hit.pixel, {
    ...style.color,
    a: effectiveAlpha,
  });
}
