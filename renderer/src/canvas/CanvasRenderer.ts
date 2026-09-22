import type { Camera, Raster, RasterLayer, WorldRect } from "@reverie/core";
import {
  compositeRgbaSourceOverInPlace,
  getRasterTilePixels,
  getRasterTileView,
  getRasterTileVersion,
  getWorldCompositionLayers,
  intersectRenderRegion,
  resolveRenderSource,
} from "@reverie/core/renderer";
import type {
  Renderer,
  RenderSourceSnapshot,
  TileCoord,
} from "@reverie/core/renderer";

import {
  DERIVED_LOD_CACHE_BUDGET_BYTES,
  MAX_CANVAS_DIMENSION,
  MAX_FRAME_SURFACE_BYTES,
} from "../config/canvas/CanvasRendererConstants.js";
import { RendererErrorDefinitions } from "../errors/RendererErrorDefinitions.js";
import {
  RendererError,
  RendererRangeError,
  RendererTypeError,
} from "../errors/RendererErrors.js";
import type { CanvasFrameSurface } from "../interfaces/canvas/CanvasFrameSurface.js";
import type { CanvasLodCacheEntry } from "../interfaces/canvas/CanvasLodCacheEntry.js";
import type { CanvasRendererConfig } from "../interfaces/canvas/CanvasRendererConfig.js";
import type { CanvasTileCache } from "../interfaces/canvas/CanvasTileCache.js";
import type { CanvasTileRange } from "../interfaces/canvas/CanvasTileRange.js";
import CanvasLodCache from "./CanvasLodCache.js";
import downsampleRgbaTile from "./DownsampleRgbaTile.js";

const CONTEXT_IDENTIFIER = "2d";

/**
 * Projects an independent sparse Raster or a composed World through a Camera
 * into an HTML canvas backing buffer.
 *
 * Rendering is explicit: camera and raster changes become visible only after
 * the caller invokes {@link render}.
 */
export class CanvasRenderer<
  Config extends CanvasRendererConfig = CanvasRendererConfig,
> implements Renderer {
  /** Canvas whose backing buffer receives each rendered frame. */
  readonly canvas: HTMLCanvasElement;

  /** Sparse raster observed without allocation or mutation. */
  get raster(): Config["raster"] {
    return this.source["raster"];
  }

  /** Document composed when the renderer was configured with a World. */
  get world(): Config["world"] {
    return this.source["world"];
  }

  private readonly source: RenderSourceSnapshot<Config>;

  /** Camera used as the world-to-screen projection for every frame. */
  readonly camera: Camera;

  private readonly context: CanvasRenderingContext2D;
  private readonly tileCanvasCache = new WeakMap<
    Raster,
    Map<string, CanvasTileCache>
  >();
  private readonly worldCompositeTileCache = new Map<string, CanvasTileCache>();
  private readonly derivedLodCache = new CanvasLodCache(
    DERIVED_LOD_CACHE_BUDGET_BYTES,
  );
  private frameSurface: CanvasFrameSurface | undefined;
  private currentPixelRatio = 1;

  /** Backing pixels used for each CSS pixel in the current viewport. */
  get pixelRatio(): number {
    return this.currentPixelRatio;
  }

  /**
   * Creates a renderer bound to one canvas, one Raster or World, and a camera.
   *
   * The renderer does not own the lifecycle of any supplied dependency.
   *
   * @param config - Canvas output, exactly one source, and Camera to observe.
   * @throws {RendererError} The canvas cannot provide a 2D rendering context.
   * @throws {RendererTypeError} Both rendering sources or neither are supplied.
   */
  constructor(config: Config) {
    const source = resolveRenderSource(config, () =>
      RendererTypeError.from(RendererErrorDefinitions.INVALID_RENDER_SOURCE),
    );
    const { canvas, camera } = config;
    const context = canvas.getContext(CONTEXT_IDENTIFIER);

    if (context === null) {
      throw RendererError.from(
        RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
      );
    }

    this.source = source;
    this.camera = camera;
    this.canvas = canvas;
    this.context = context;
  }

  /**
   * Clears the canvas and draws every allocated tile intersecting the current
   * camera viewport.
   *
   * Missing tiles are skipped without allocation. Unchanged tile uploads are
   * reused by identity and revision while the viewport is still fully redrawn.
   */
  render(): void {
    const { width, height } = this.canvas;
    const effectiveScale = this.camera.zoom * this.currentPixelRatio;
    const shouldSmooth = effectiveScale < 1;

    this.context.clearRect(0, 0, width, height);
    this.context.imageSmoothingEnabled = shouldSmooth;
    if (shouldSmooth) {
      this.context.imageSmoothingQuality = "high";
    }

    if (width === 0 || height === 0) {
      return;
    }

    const bounds = this.world?.bounds ?? null;
    const visibleWorldRect = intersectRenderRegion(
      this.camera.visibleWorldRect({
        width: width / this.currentPixelRatio,
        height: height / this.currentPixelRatio,
      }),
      bounds,
    );
    if (visibleWorldRect === null) {
      return;
    }

    if (shouldSmooth) {
      this.context.save();
      try {
        this.context.globalAlpha = 1;
        this.context.globalCompositeOperation = "source-over";
        if (bounds !== null) {
          const point = this.camera.worldToScreen(bounds);
          this.context.beginPath();
          this.context.rect(
            point.x * this.currentPixelRatio,
            point.y * this.currentPixelRatio,
            bounds.width * effectiveScale,
            bounds.height * effectiveScale,
          );
          this.context.clip();
        }
        this.renderMinifiedSource(visibleWorldRect, effectiveScale);
      } finally {
        this.context.restore();
      }
      return;
    }

    if (this.world !== undefined) {
      this.context.save();
      try {
        this.context.globalCompositeOperation = "source-over";
        if (bounds !== null) {
          const point = this.camera.worldToScreen(bounds);
          const scale = this.camera.zoom * this.currentPixelRatio;
          this.context.beginPath();
          this.context.rect(
            point.x * this.currentPixelRatio,
            point.y * this.currentPixelRatio,
            bounds.width * scale,
            bounds.height * scale,
          );
          this.context.clip();
        }
        const layers = [...getWorldCompositionLayers(this.world)];
        const hasCustomBlendMode = layers.some(
          (layer) => layer.blendMode !== "normal",
        );
        if (hasCustomBlendMode) {
          this.context.globalAlpha = 1;
          this.renderComposedWorld(layers, visibleWorldRect);
        } else {
          for (const layer of layers) {
            this.context.globalAlpha = layer.opacity;
            this.renderRaster(layer.raster, visibleWorldRect);
          }
        }
      } finally {
        this.context.restore();
      }
    } else if (this.raster !== undefined) {
      this.renderRaster(this.raster, visibleWorldRect);
    }
  }

  /** Assembles cached LOD tiles into one continuous surface before sampling. */
  private renderMinifiedSource(
    visibleWorldRect: WorldRect,
    effectiveScale: number,
  ): void {
    const layers =
      this.world === undefined
        ? undefined
        : [...getWorldCompositionLayers(this.world)];
    if (layers !== undefined && layers.length === 0) {
      return;
    }

    const tileSize =
      this.raster?.tileSize ?? this.world?.layers[0]?.raster.tileSize;
    if (tileSize === undefined) {
      return;
    }

    const range = CanvasRenderer.visibleTileRange(
      tileSize,
      visibleWorldRect,
      1,
    );
    if (range === null) {
      return;
    }

    const level = CanvasRenderer.resolveFrameLodLevel(
      tileSize,
      range,
      effectiveScale,
    );
    if (level === null) {
      return;
    }

    const outputTileSize = CanvasRenderer.lodTileSize(tileSize, level);
    const tileCountX = range.maxX - range.minX + 1;
    const tileCountY = range.maxY - range.minY + 1;
    const surfaceWidth = tileCountX * outputTileSize;
    const surfaceHeight = tileCountY * outputTileSize;
    const surface = this.getFrameSurface(surfaceWidth, surfaceHeight);

    surface.context.clearRect(0, 0, surfaceWidth, surfaceHeight);
    surface.context.imageSmoothingEnabled = false;
    surface.context.globalAlpha = 1;
    surface.context.globalCompositeOperation = "source-over";

    for (let tileY = range.minY; tileY <= range.maxY; tileY += 1) {
      for (let tileX = range.minX; tileX <= range.maxX; tileX += 1) {
        const tileCanvas = this.getDerivedLodTile(
          { x: tileX, y: tileY },
          tileSize,
          outputTileSize,
          level,
          layers,
        );
        if (tileCanvas === undefined) {
          continue;
        }

        surface.context.drawImage(
          tileCanvas,
          (tileX - range.minX) * outputTileSize,
          (tileY - range.minY) * outputTileSize,
        );
      }
    }

    const worldX = range.minX * tileSize;
    const worldY = range.minY * tileSize;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) {
      return;
    }
    const screenPoint = this.camera.worldToScreen({ x: worldX, y: worldY });

    this.context.drawImage(
      surface.canvas,
      screenPoint.x * this.currentPixelRatio,
      screenPoint.y * this.currentPixelRatio,
      tileCountX * tileSize * effectiveScale,
      tileCountY * tileSize * effectiveScale,
    );
  }

  /** Returns a current alpha-correct LOD surface for one nonempty source Tile. */
  private getDerivedLodTile(
    coord: TileCoord,
    tileSize: number,
    outputTileSize: number,
    level: number,
    layers: RasterLayer[] | undefined,
  ): HTMLCanvasElement | undefined {
    const key = `${level}:${CanvasRenderer.tileCoordToKey(coord)}`;
    const signature = this.derivedTileSignature(coord, layers);
    if (signature === null) {
      this.derivedLodCache.delete(key);
      return undefined;
    }

    const cachedEntry = this.derivedLodCache.get(key);
    if (cachedEntry?.signature === signature) {
      return cachedEntry.canvas;
    }

    const sourcePixels = this.createFullResolutionSourceTile(
      coord,
      tileSize,
      layers,
    );
    if (sourcePixels === undefined) {
      this.derivedLodCache.delete(key);
      return undefined;
    }

    const entry =
      cachedEntry ?? this.createLodCacheEntry(outputTileSize, signature);
    const filteredPixels = downsampleRgbaTile(
      sourcePixels,
      tileSize,
      outputTileSize,
    );
    const imageData = entry.context.createImageData(
      outputTileSize,
      outputTileSize,
    );
    imageData.data.set(filteredPixels);
    entry.context.putImageData(imageData, 0, 0);
    entry.signature = signature;
    this.derivedLodCache.set(key, entry);
    return entry.canvas;
  }

  /** Builds the 3-by-3 source-state signature required by seam-aware caching. */
  private derivedTileSignature(
    coord: TileCoord,
    layers: RasterLayer[] | undefined,
  ): string | null {
    let hasCenterSource = false;
    const signatureParts: string[] = [];

    if (layers === undefined) {
      const raster = this.raster;
      if (raster === undefined) {
        return null;
      }
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const version = getRasterTileVersion(raster, {
            x: coord.x + offsetX,
            y: coord.y + offsetY,
          });
          if (offsetX === 0 && offsetY === 0 && version !== undefined) {
            hasCenterSource = true;
          }
          signatureParts.push(
            `${version?.tileId ?? -1},${version?.revision ?? -1}`,
          );
        }
      }
      return hasCenterSource ? signatureParts.join("|") : null;
    }

    for (const layer of layers) {
      signatureParts.push(`${layer.opacity},${layer.blendMode}`);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const version = getRasterTileVersion(layer.raster, {
            x: coord.x + offsetX,
            y: coord.y + offsetY,
          });
          if (offsetX === 0 && offsetY === 0 && version !== undefined) {
            hasCenterSource = true;
          }
          signatureParts.push(
            `${version?.tileId ?? -1},${version?.revision ?? -1}`,
          );
        }
      }
    }

    return hasCenterSource ? signatureParts.join("|") : null;
  }

  /** Reads or composes the authoritative full-resolution pixels for one Tile. */
  private createFullResolutionSourceTile(
    coord: TileCoord,
    tileSize: number,
    layers: RasterLayer[] | undefined,
  ): Uint8ClampedArray | undefined {
    if (layers === undefined) {
      return this.raster === undefined
        ? undefined
        : getRasterTilePixels(this.raster, coord);
    }

    const pixels = new Uint8ClampedArray(tileSize * tileSize * 4);
    let hasSource = false;
    for (const layer of layers) {
      const tileView = getRasterTileView(layer.raster, coord);
      if (tileView === undefined) {
        continue;
      }
      hasSource = true;
      for (let offset = 0; offset < tileView.pixels.length; offset += 4) {
        compositeRgbaSourceOverInPlace(
          tileView.pixels,
          offset,
          pixels,
          offset,
          layer.opacity,
          layer.blendMode,
        );
      }
    }
    return hasSource ? pixels : undefined;
  }

  /** Creates one cacheable LOD canvas with no retained duplicate pixel buffer. */
  private createLodCacheEntry(
    outputTileSize: number,
    signature: string,
  ): CanvasLodCacheEntry {
    const canvas = this.canvas.ownerDocument.createElement("canvas");
    canvas.width = outputTileSize;
    canvas.height = outputTileSize;
    const context = canvas.getContext(CONTEXT_IDENTIFIER);
    if (context === null) {
      throw RendererError.from(
        RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
      );
    }
    return {
      canvas,
      context,
      byteCost: outputTileSize * outputTileSize * 4,
      signature,
    };
  }

  /** Returns and resizes the reusable contiguous minification surface. */
  private getFrameSurface(width: number, height: number): CanvasFrameSurface {
    if (this.frameSurface === undefined) {
      const canvas = this.canvas.ownerDocument.createElement("canvas");
      const context = canvas.getContext(CONTEXT_IDENTIFIER);
      if (context === null) {
        throw RendererError.from(
          RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
        );
      }
      this.frameSurface = { canvas, context };
    }

    if (this.frameSurface.canvas.width !== width) {
      this.frameSurface.canvas.width = width;
    }
    if (this.frameSurface.canvas.height !== height) {
      this.frameSurface.canvas.height = height;
    }
    return this.frameSurface;
  }

  /** Traverses visible tiles of one source using a Raster-specific upload cache. */
  private renderRaster(raster: Raster, visibleWorldRect: WorldRect): void {
    const tileSize = raster.tileSize;
    for (const coord of CanvasRenderer.visibleTileCoords(
      tileSize,
      visibleWorldRect,
    )) {
      this.renderTile(raster, coord);
    }
  }

  /** Composes non-normal World layers into dense tiles before projection. */
  private renderComposedWorld(
    layers: RasterLayer[],
    visibleWorldRect: WorldRect,
  ): void {
    const tileSize = layers[0]?.raster.tileSize;
    if (tileSize === undefined) {
      return;
    }
    const visibleKeys = new Set<string>();
    for (const coord of CanvasRenderer.visibleTileCoords(
      tileSize,
      visibleWorldRect,
    )) {
      const key = CanvasRenderer.tileCoordToKey(coord);
      visibleKeys.add(key);
      const signature = this.worldTileSignature(layers, coord);
      if (signature === null) {
        this.worldCompositeTileCache.delete(key);
        continue;
      }

      const cache = this.getWorldCompositeTileCache(coord, tileSize);
      if (cache.signature !== signature) {
        cache.imageData.data.fill(0);
        for (const layer of layers) {
          const tileView = getRasterTileView(layer.raster, coord);
          if (tileView === undefined) {
            continue;
          }
          for (let offset = 0; offset < tileView.pixels.length; offset += 4) {
            compositeRgbaSourceOverInPlace(
              tileView.pixels,
              offset,
              cache.imageData.data,
              offset,
              layer.opacity,
              layer.blendMode,
            );
          }
        }
        cache.context.putImageData(cache.imageData, 0, 0);
        cache.signature = signature;
      }
      this.drawTileCanvas(cache.canvas, coord, tileSize);
    }
    for (const key of this.worldCompositeTileCache.keys()) {
      if (!visibleKeys.has(key)) {
        this.worldCompositeTileCache.delete(key);
      }
    }
  }

  /** Builds a stable cache key from all contributing layer state for a tile. */
  private worldTileSignature(
    layers: RasterLayer[],
    coord: TileCoord,
  ): string | null {
    let hasSource = false;
    const signatureParts: string[] = [];
    for (const layer of layers) {
      const version = getRasterTileVersion(layer.raster, coord);
      if (version !== undefined) {
        hasSource = true;
      }
      signatureParts.push(
        `${version?.tileId ?? -1},${version?.revision ?? -1},${layer.opacity},${layer.blendMode}`,
      );
    }
    return hasSource ? signatureParts.join("|") : null;
  }

  /** Returns the reusable offscreen tile used for World blend-mode output. */
  private getWorldCompositeTileCache(
    coord: TileCoord,
    tileSize: number,
  ): CanvasTileCache {
    const key = CanvasRenderer.tileCoordToKey(coord);
    const cachedTile = this.worldCompositeTileCache.get(key);
    if (cachedTile !== undefined) {
      return cachedTile;
    }

    const cache = this.createTileCache(tileSize);
    this.worldCompositeTileCache.set(key, cache);
    return cache;
  }

  /**
   * Changes the canvas backing-buffer dimensions used as the screen viewport.
   *
   * Resizing does not render automatically. Zero-sized canvases are valid.
   *
   * @param width - Non-negative finite integer width in backing pixels.
   * @param height - Non-negative finite integer height in backing pixels.
   * @param pixelRatio - Positive finite backing pixels per CSS pixel. Defaults
   * to `1` for compatibility with direct low-level renderer use.
   * @throws {RendererTypeError} A dimension is not a number.
   * @throws {RendererRangeError} A dimension is negative, fractional, or not finite.
   */
  resize(width: number, height: number, pixelRatio = 1): void {
    CanvasRenderer.assertValidCanvasSize(width, height);
    CanvasRenderer.assertValidPixelRatio(pixelRatio);

    this.canvas.width = width;
    this.canvas.height = height;
    this.currentPixelRatio = pixelRatio;
  }

  /** Releases cached canvas surfaces retained by this renderer. */
  dispose(): void {
    this.worldCompositeTileCache.clear();
    this.derivedLodCache.clear();
    this.frameSurface = undefined;
  }

  /** Draws one allocated tile, uploading only when its version changed. */
  private renderTile(raster: Raster, coord: TileCoord): void {
    const version = getRasterTileVersion(raster, coord);

    if (version === undefined) {
      return;
    }

    const tileSize = raster.tileSize;
    const cache = this.getTileCache(raster, coord, tileSize);
    const hasCurrentUpload =
      cache.tileId === version.tileId && cache.revision === version.revision;

    if (!hasCurrentUpload) {
      const pixels = getRasterTilePixels(raster, coord);

      if (pixels === undefined) {
        return;
      }

      cache.imageData.data.set(pixels);
      cache.context.putImageData(cache.imageData, 0, 0);
      cache.tileId = version.tileId;
      cache.revision = version.revision;
    }

    this.drawTileCanvas(cache.canvas, coord, tileSize);
  }

  /** Projects one prepared tile canvas using the active camera. */
  private drawTileCanvas(
    tileCanvas: HTMLCanvasElement,
    coord: TileCoord,
    tileSize: number,
  ): void {
    const screenPoint = this.camera.worldToScreen({
      x: coord.x * tileSize,
      y: coord.y * tileSize,
    });
    const renderZoom = this.camera.zoom * this.currentPixelRatio;
    const screenTileSize = tileSize * renderZoom;

    this.context.drawImage(
      tileCanvas,
      screenPoint.x * this.currentPixelRatio,
      screenPoint.y * this.currentPixelRatio,
      screenTileSize,
      screenTileSize,
    );
  }

  /** Returns a complete tile upload cache, creating it on first use. */
  private getTileCache(
    raster: Raster,
    coord: TileCoord,
    tileSize: number,
  ): CanvasTileCache {
    let rasterCache = this.tileCanvasCache.get(raster);
    if (rasterCache === undefined) {
      rasterCache = new Map<string, CanvasTileCache>();
      this.tileCanvasCache.set(raster, rasterCache);
    }
    const key = CanvasRenderer.tileCoordToKey(coord);
    const cachedTile = rasterCache.get(key);

    if (cachedTile !== undefined) {
      return cachedTile;
    }

    const cache = this.createTileCache(tileSize);

    rasterCache.set(key, cache);

    return cache;
  }

  /** Creates one reusable tile canvas and upload buffer. */
  private createTileCache(tileSize: number): CanvasTileCache {
    const tileCanvas = this.canvas.ownerDocument.createElement("canvas");
    tileCanvas.width = tileSize;
    tileCanvas.height = tileSize;
    const tileContext = tileCanvas.getContext(CONTEXT_IDENTIFIER);
    if (tileContext === null) {
      throw RendererError.from(
        RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
      );
    }
    return {
      canvas: tileCanvas,
      context: tileContext,
      imageData: tileContext.createImageData(tileSize, tileSize),
      tileId: -1,
      revision: -1,
    };
  }

  /** Enumerates every tile whose area can intersect a visible world rectangle. */
  private static *visibleTileCoords(
    tileSize: number,
    visibleWorldRect: WorldRect,
  ): Iterable<TileCoord> {
    const range = CanvasRenderer.visibleTileRange(
      tileSize,
      visibleWorldRect,
      0,
    );
    if (range === null) {
      return;
    }

    for (let tileY = range.minY; tileY <= range.maxY; tileY += 1) {
      for (let tileX = range.minX; tileX <= range.maxX; tileX += 1) {
        yield { x: tileX, y: tileY };
      }
    }
  }

  /** Resolves a finite, safe Tile range with an optional sampling margin. */
  private static visibleTileRange(
    tileSize: number,
    visibleWorldRect: WorldRect,
    margin: number,
  ): CanvasTileRange | null {
    const right = visibleWorldRect.x + visibleWorldRect.width;
    const bottom = visibleWorldRect.y + visibleWorldRect.height;
    if (!Number.isFinite(right) || !Number.isFinite(bottom)) {
      return null;
    }

    const minX = Math.floor(visibleWorldRect.x / tileSize) - margin;
    const minY = Math.floor(visibleWorldRect.y / tileSize) - margin;
    const maxX = Math.ceil(right / tileSize) - 1 + margin;
    const maxY = Math.ceil(bottom / tileSize) - 1 + margin;
    const coordinates = [minX, minY, maxX, maxY];
    if (!coordinates.every(Number.isSafeInteger)) {
      return null;
    }
    if (maxX < minX || maxY < minY) {
      return null;
    }

    return { minX, minY, maxX, maxY };
  }

  /** Chooses the nearest useful LOD that also fits the transient frame surface. */
  private static resolveFrameLodLevel(
    tileSize: number,
    range: CanvasTileRange,
    effectiveScale: number,
  ): number | null {
    const maximumLevel = Math.ceil(Math.log2(tileSize));
    const idealLevel = Math.max(
      0,
      Math.min(maximumLevel, Math.round(Math.log2(1 / effectiveScale))),
    );

    for (let level = idealLevel; level <= maximumLevel; level += 1) {
      const outputTileSize = CanvasRenderer.lodTileSize(tileSize, level);
      const tileCountX = range.maxX - range.minX + 1;
      const tileCountY = range.maxY - range.minY + 1;
      const width = tileCountX * outputTileSize;
      const height = tileCountY * outputTileSize;
      const byteCost = width * height * 4;
      const dimensionsAreSafe =
        Number.isSafeInteger(width) &&
        Number.isSafeInteger(height) &&
        width > 0 &&
        height > 0 &&
        width <= MAX_CANVAS_DIMENSION &&
        height <= MAX_CANVAS_DIMENSION;

      if (
        dimensionsAreSafe &&
        Number.isSafeInteger(byteCost) &&
        byteCost <= MAX_FRAME_SURFACE_BYTES
      ) {
        return level;
      }
    }

    return null;
  }

  /** Returns the square Tile dimension represented by one LOD level. */
  private static lodTileSize(tileSize: number, level: number): number {
    return Math.max(1, Math.ceil(tileSize / 2 ** level));
  }

  /** Converts a validated tile coordinate into a collision-free cache key. */
  private static tileCoordToKey(coord: TileCoord): string {
    return `${coord.x}:${coord.y}`;
  }

  /** Validates both dimensions before resize mutates either canvas property. */
  private static assertValidCanvasSize(width: unknown, height: unknown): void {
    const dimensionsAreNumbers =
      typeof width === "number" && typeof height === "number";

    if (!dimensionsAreNumbers) {
      throw RendererTypeError.from(
        RendererErrorDefinitions.INVALID_CANVAS_SIZE,
        { width: String(width), height: String(height) },
      );
    }

    const dimensionsAreValid =
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width >= 0 &&
      height >= 0;

    if (!dimensionsAreValid) {
      throw RendererRangeError.from(
        RendererErrorDefinitions.INVALID_CANVAS_SIZE,
        { width, height },
      );
    }
  }

  /** Validates the CSS-to-backing scale before resize mutates renderer state. */
  private static assertValidPixelRatio(pixelRatio: unknown): void {
    if (typeof pixelRatio !== "number") {
      throw RendererTypeError.from(
        RendererErrorDefinitions.INVALID_PIXEL_RATIO,
        { pixelRatio: String(pixelRatio) },
      );
    }

    if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
      throw RendererRangeError.from(
        RendererErrorDefinitions.INVALID_PIXEL_RATIO,
        { pixelRatio },
      );
    }
  }
}
