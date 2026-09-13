import type { RGBAColor, Raster } from "@reverie/core";

/** Leftmost world-pixel column of the painted scene. */
const SCENE_MIN_X = -32;

/** Rightmost world-pixel column of the painted scene. */
const SCENE_MAX_X = 31;

/** Topmost world-pixel row of the painted scene. */
const SCENE_MIN_Y = -20;

/** Bottommost world-pixel row of the painted scene. */
const SCENE_MAX_Y = 20;

/** World-pixel row that separates the sky from the ground. */
const HORIZON_Y = 4;

/** Horizontal center of the setting sun in world pixels. */
const SUN_CENTER_X = 18;

/** Vertical center of the setting sun in world pixels. */
const SUN_CENTER_Y = -6;

/** Radius of the sun disc in pixels. */
const SUN_RADIUS = 7;

/** Horizontal center of the tree canopy in world pixels. */
const TREE_CENTER_X = 4;

/** Vertical center of the tree canopy in world pixels. */
const TREE_CANOPY_Y = 0;

/** Radius of the circular tree canopy in pixels. */
const TREE_CANOPY_RADIUS = 5;

/** World-pixel row where the tree trunk meets the ground. */
const TREE_BASE_Y = 12;

/** Half-width of the tree trunk in pixels. */
const TREE_TRUNK_HALF_WIDTH = 1;

/** Columns at least this tall receive a snow cap. */
const SNOW_CAP_MIN_HEIGHT = 13;

/** Sky color at the top edge of the scene. */
const SKY_TOP_COLOR: RGBAColor = { r: 18, g: 24, b: 72, a: 255 };

/** Sky color where the scene meets the horizon. */
const SKY_HORIZON_COLOR: RGBAColor = { r: 250, g: 140, b: 90, a: 255 };

/** Sun color inside the disc. */
const SUN_CORE_COLOR: RGBAColor = { r: 255, g: 240, b: 170, a: 255 };

/** Sun color along the two outermost rings of the disc. */
const SUN_GLOW_COLOR: RGBAColor = { r: 255, g: 186, b: 96, a: 255 };

/** Mountain silhouette color. */
const MOUNTAIN_COLOR: RGBAColor = { r: 74, g: 56, b: 108, a: 255 };

/** Highlight color for the snow caps on tall peaks. */
const SNOW_COLOR: RGBAColor = { r: 228, g: 232, b: 244, a: 255 };

/** Ground color directly below the horizon. */
const GROUND_TOP_COLOR: RGBAColor = { r: 62, g: 102, b: 70, a: 255 };

/** Ground color along the bottom edge of the scene. */
const GROUND_BOTTOM_COLOR: RGBAColor = { r: 16, g: 38, b: 32, a: 255 };

/** Tree canopy color. */
const TREE_CANOPY_COLOR: RGBAColor = { r: 26, g: 84, b: 56, a: 255 };

/** Tree trunk color. */
const TREE_TRUNK_COLOR: RGBAColor = { r: 96, g: 66, b: 44, a: 255 };

/** Single-pixel star color. */
const STAR_COLOR: RGBAColor = { r: 255, g: 248, b: 214, a: 255 };

/** Peak columns of the mountain ridge, each paired with its height in pixels. */
const MOUNTAIN_PEAKS: readonly (readonly [number, number])[] = [
  [-24, 15],
  [-11, 9],
];

/** Star positions chosen to remain visible above the ridge and clear of the sun. */
const STAR_POSITIONS: readonly (readonly [number, number])[] = [
  [-23, -14],
  [-21, -11],
  [-18, -15],
  [-16, -10],
  [-13, -13],
  [-7, -11],
  [-3, -14],
  [1, -12],
  [5, -10],
  [9, -15],
  [26, -9],
  [27, -15],
  [29, -13],
  [30, -4],
];

/**
 * Paints a pixel-art dusk landscape into a raster with `setPixel` only.
 *
 * The scene spans a 4x4 block of 16-pixel tiles from `(-32, -20)` to
 * `(31, 20)`, so it deliberately covers both negative and positive tile
 * coordinates and every world pixel inside that region. It is meant as a
 * larger, multi-tile fixture for demoing and testing the renderer rather than
 * as a reusable engine API.
 *
 * @param raster - Target raster whose existing pixels are overwritten.
 * @example
 * const raster = new Raster({ tileSize: 16 });
 * populateDemoRaster(raster);
 */
export function populateDemoRaster(raster: Raster): void {
  paintSky(raster);
  paintStars(raster);
  paintSun(raster);
  paintMountains(raster);
  paintGround(raster);
  paintTree(raster);
}

/** Fills the sky region with a vertical dusk gradient. */
function paintSky(raster: Raster): void {
  const span = HORIZON_Y - SCENE_MIN_Y;

  for (let y = SCENE_MIN_Y; y <= HORIZON_Y; y += 1) {
    const color = blendColors(
      SKY_TOP_COLOR,
      SKY_HORIZON_COLOR,
      (y - SCENE_MIN_Y) / span,
    );

    for (let x = SCENE_MIN_X; x <= SCENE_MAX_X; x += 1) {
      raster.setPixel({ x, y }, color);
    }
  }
}

/** Writes one single-pixel star per entry in {@link STAR_POSITIONS}. */
function paintStars(raster: Raster): void {
  for (const [x, y] of STAR_POSITIONS) {
    raster.setPixel({ x, y }, STAR_COLOR);
  }
}

/** Draws the sun as a filled disc with a brighter core and glowing edge. */
function paintSun(raster: Raster): void {
  for (let y = SUN_CENTER_Y - SUN_RADIUS; y <= SUN_CENTER_Y + SUN_RADIUS; y += 1) {
    for (let x = SUN_CENTER_X - SUN_RADIUS; x <= SUN_CENTER_X + SUN_RADIUS; x += 1) {
      const distance = Math.hypot(x - SUN_CENTER_X, y - SUN_CENTER_Y);

      if (distance > SUN_RADIUS) {
        continue;
      }

      const isGlowRing = distance > SUN_RADIUS - 2;
      raster.setPixel({ x, y }, isGlowRing ? SUN_GLOW_COLOR : SUN_CORE_COLOR);
    }
  }
}

/** Fills the mountain silhouette between its ridgeline and the horizon. */
function paintMountains(raster: Raster): void {
  for (let x = SCENE_MIN_X; x <= SCENE_MAX_X; x += 1) {
    const height = mountainHeightAt(x);

    if (height <= 0) {
      continue;
    }

    const ridgeY = HORIZON_Y - height;

    for (let y = ridgeY; y <= HORIZON_Y; y += 1) {
      const isSnowCap = height >= SNOW_CAP_MIN_HEIGHT && y <= ridgeY + 1;
      raster.setPixel({ x, y }, isSnowCap ? SNOW_COLOR : MOUNTAIN_COLOR);
    }
  }
}

/**
 * Returns the silhouette height of the ridge at one world-pixel column.
 *
 * @param x - World-pixel column to sample.
 * @returns The tallest peak height at that column, or `0` outside the ridge.
 */
function mountainHeightAt(x: number): number {
  let height = 0;

  for (const [peakX, peakHeight] of MOUNTAIN_PEAKS) {
    const candidate = peakHeight - Math.abs(x - peakX);

    if (candidate > height) {
      height = candidate;
    }
  }

  return height;
}

/** Fills the ground region with a vertical gradient. */
function paintGround(raster: Raster): void {
  const topY = HORIZON_Y + 1;
  const span = SCENE_MAX_Y - topY;

  for (let y = topY; y <= SCENE_MAX_Y; y += 1) {
    const color = blendColors(
      GROUND_TOP_COLOR,
      GROUND_BOTTOM_COLOR,
      (y - topY) / span,
    );

    for (let x = SCENE_MIN_X; x <= SCENE_MAX_X; x += 1) {
      raster.setPixel({ x, y }, color);
    }
  }
}

/** Draws a trunk first, then the canopy over it, so the tree reads as a silhouette. */
function paintTree(raster: Raster): void {
  const trunkTop = TREE_CANOPY_Y + 2;

  for (let y = trunkTop; y <= TREE_BASE_Y; y += 1) {
    for (
      let x = TREE_CENTER_X - TREE_TRUNK_HALF_WIDTH;
      x <= TREE_CENTER_X + TREE_TRUNK_HALF_WIDTH;
      x += 1
    ) {
      raster.setPixel({ x, y }, TREE_TRUNK_COLOR);
    }
  }

  const radius = TREE_CANOPY_RADIUS;

  for (let y = TREE_CANOPY_Y - radius; y <= TREE_CANOPY_Y + radius; y += 1) {
    for (let x = TREE_CENTER_X - radius; x <= TREE_CENTER_X + radius; x += 1) {
      const distance = Math.hypot(x - TREE_CENTER_X, y - TREE_CANOPY_Y);

      if (distance > radius) {
        continue;
      }

      raster.setPixel({ x, y }, TREE_CANOPY_COLOR);
    }
  }
}

/**
 * Blends two opaque RGBA8 colors channel by channel.
 *
 * @param from - Color returned when `t` is `0`.
 * @param to - Color returned when `t` is `1`.
 * @param t - Interpolation factor, clamped to the `0..1` range.
 * @returns A new color whose channels are rounded to integers.
 */
function blendColors(from: RGBAColor, to: RGBAColor, t: number): RGBAColor {
  const factor = Math.min(1, Math.max(0, t));

  return {
    r: blendChannel(from.r, to.r, factor),
    g: blendChannel(from.g, to.g, factor),
    b: blendChannel(from.b, to.b, factor),
    a: blendChannel(from.a, to.a, factor),
  };
}

/**
 * Interpolates one RGBA8 channel.
 *
 * @param from - Channel value when `t` is `0`.
 * @param to - Channel value when `t` is `1`.
 * @param t - Interpolation factor already clamped to `0..1`.
 * @returns The rounded channel value.
 */
function blendChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}
