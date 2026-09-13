import type { Camera, Raster } from "@reverie/core";
import {
  getRasterTilePixels,
  getRasterTileVersion,
} from "@reverie/core/renderer";
import type { Renderer, TileCoord } from "@reverie/core/renderer";

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
 * Projects the allocated pixels of a sparse Raster through a Camera into an
 * HTML canvas backing buffer.
 *
 * Rendering is explicit: camera and raster changes become visible only after
 * the caller invokes {@link render}.
 */
export class CanvasRenderer implements Renderer {
  /** Canvas whose backing buffer receives each rendered frame. */
  readonly canvas: HTMLCanvasElement;

  /** Sparse raster observed without allocation or mutation. */
  readonly raster: Raster;

  /** Camera used as the world-to-screen projection for every frame. */
  readonly camera: Camera;

  private readonly context: CanvasRenderingContext2D;
  private readonly tileCanvasCache = new Map<string, CanvasTileCache>();
  private currentPixelRatio = 1;

  /** Backing pixels used for each CSS pixel in the current viewport. */
  get pixelRatio(): number {
    return this.currentPixelRatio;
  }

  /**
   * Creates a renderer bound to one canvas, raster, and camera.
   *
   * The renderer does not own the lifecycle of any supplied dependency.
   *
   * @param config - Canvas output and the Raster and Camera to observe.
   * @throws {RendererError} The canvas cannot provide a 2D rendering context.
   */
  constructor({ canvas, camera, raster }: CanvasRendererConfig) {
    const context = canvas.getContext(CONTEXT_IDENTIFIER);

    if (context === null) {
      throw RendererError.from(
        RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
      );
    }

    this.raster = raster;
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

    const visibleWorldRect = this.camera.visibleWorldRect({
      width: width / this.currentPixelRatio,
      height: height / this.currentPixelRatio,
    });
    const tileSize = this.raster.tileSize;
    const minTileX = Math.floor(visibleWorldRect.x / tileSize);
    const minTileY = Math.floor(visibleWorldRect.y / tileSize);
    const maxTileX =
      Math.ceil((visibleWorldRect.x + visibleWorldRect.width) / tileSize) - 1;
    const maxTileY =
      Math.ceil((visibleWorldRect.y + visibleWorldRect.height) / tileSize) - 1;

    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        this.renderTile({ x: tileX, y: tileY });
      }
    }
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
  private renderTile(coord: TileCoord): void {
    const version = getRasterTileVersion(this.raster, coord);

    if (version === undefined) {
      return;
    }

    const tileSize = this.raster.tileSize;
    const cache = this.getTileCache(coord, tileSize);
    const hasCurrentUpload =
      cache.tileId === version.tileId && cache.revision === version.revision;

    if (!hasCurrentUpload) {
      const pixels = getRasterTilePixels(this.raster, coord);

      if (pixels === undefined) {
        return;
      }

      cache.imageData.data.set(pixels);
      cache.context.putImageData(cache.imageData, 0, 0);
      cache.tileId = version.tileId;
      cache.revision = version.revision;
    }

    const screenPoint = this.camera.worldToScreen({
      x: coord.x * tileSize,
      y: coord.y * tileSize,
    });
    const renderZoom = this.camera.zoom * this.currentPixelRatio;
    const screenTileSize = tileSize * renderZoom;

    this.context.drawImage(
      cache.canvas,
      screenPoint.x * this.currentPixelRatio,
      screenPoint.y * this.currentPixelRatio,
      screenTileSize,
      screenTileSize,
    );
  }

  /** Returns a complete tile upload cache, creating it on first use. */
  private getTileCache(coord: TileCoord, tileSize: number): CanvasTileCache {
    const key = CanvasRenderer.tileCoordToKey(coord);
    const cachedTile = this.tileCanvasCache.get(key);

    if (cachedTile !== undefined) {
      return cachedTile;
    }

    const tileCanvas = this.canvas.ownerDocument.createElement("canvas");
    tileCanvas.width = tileSize;
    tileCanvas.height = tileSize;
    const tileContext = tileCanvas.getContext(CONTEXT_IDENTIFIER);

    if (tileContext === null) {
      throw RendererError.from(
        RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
      );
    }

    const cache: CanvasTileCache = {
      canvas: tileCanvas,
      context: tileContext,
      imageData: tileContext.createImageData(tileSize, tileSize),
      tileId: -1,
      revision: -1,
    };

    this.tileCanvasCache.set(key, cache);

    return cache;
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
