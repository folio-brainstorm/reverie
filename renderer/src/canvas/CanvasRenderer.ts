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

import { RendererErrorDefinitions } from "../errors/RendererErrorDefinitions.js";
import {
  RendererError,
  RendererRangeError,
  RendererTypeError,
} from "../errors/RendererErrors.js";
import type { CanvasRendererConfig } from "../interfaces/canvas/CanvasRendererConfig.js";
import type { CanvasTileCache } from "../interfaces/canvas/CanvasTileCache.js";

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

    this.context.clearRect(0, 0, width, height);
    this.context.imageSmoothingEnabled = false;

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
    const minTileX = Math.floor(visibleWorldRect.x / tileSize);
    const minTileY = Math.floor(visibleWorldRect.y / tileSize);
    const maxTileX =
      Math.ceil((visibleWorldRect.x + visibleWorldRect.width) / tileSize) - 1;
    const maxTileY =
      Math.ceil((visibleWorldRect.y + visibleWorldRect.height) / tileSize) - 1;

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        yield { x: tileX, y: tileY };
      }
    }
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
