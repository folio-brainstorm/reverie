import type { Camera, Raster } from "@reverie/core";
import { getRasterTilePixels } from "@reverie/core/renderer";
import type { Renderer, TileCoord } from "@reverie/core/renderer";

import { RendererError, RendererTypeError, RendererRangeError } from "../errors/RendererErrors.js";
import { RendererErrorDefinitions } from "../errors/RendererErrorDefinitions.js";
import type { CanvasRendererConfig } from "../interfaces/canvas/CanvasRendererConfig.js";

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
  private readonly tileCanvasCache = new Map<string, HTMLCanvasElement>();

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
   * Missing tiles are skipped without allocation. Tile images are uploaded in
   * full on every call, while their temporary canvases are reused by coordinate.
   */
  render(): void {
    const { width, height } = this.canvas;

    this.context.clearRect(0, 0, width, height);
    this.context.imageSmoothingEnabled = false;

    if (width === 0 || height === 0) {
      return;
    }

    const visibleWorldRect = this.camera.visibleWorldRect({ width, height });
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
   * @param width - Non-negative finite integer width in screen pixels.
   * @param height - Non-negative finite integer height in screen pixels.
   * @throws {RendererTypeError} A dimension is not a number.
   * @throws {RendererRangeError} A dimension is negative, fractional, or not finite.
   */
  resize(width: number, height: number): void {
    CanvasRenderer.assertValidCanvasSize(width, height);

    this.canvas.width = width;
    this.canvas.height = height;
  }

  /** Draws one allocated tile after uploading its current RGBA8 snapshot. */
  private renderTile(coord: TileCoord): void {
    const pixels = getRasterTilePixels(this.raster, coord);

    if (pixels === undefined) {
      return;
    }

    const tileSize = this.raster.tileSize;
    const tileCanvas = this.getTileCanvas(coord, tileSize);
    const tileContext = tileCanvas.getContext(CONTEXT_IDENTIFIER);

    if (tileContext === null) {
      throw RendererError.from(
        RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
      );
    }

    const imageData = tileContext.createImageData(tileSize, tileSize);
    imageData.data.set(pixels);
    tileContext.putImageData(imageData, 0, 0);

    const screenPoint = this.camera.worldToScreen({
      x: coord.x * tileSize,
      y: coord.y * tileSize,
    });
    const screenTileSize = tileSize * this.camera.zoom;

    this.context.drawImage(
      tileCanvas,
      screenPoint.x,
      screenPoint.y,
      screenTileSize,
      screenTileSize,
    );
  }

  /** Returns a cached tile-sized canvas, creating it on first use. */
  private getTileCanvas(
    coord: TileCoord,
    tileSize: number,
  ): HTMLCanvasElement {
    const key = CanvasRenderer.tileCoordToKey(coord);
    const cachedCanvas = this.tileCanvasCache.get(key);

    if (cachedCanvas !== undefined) {
      return cachedCanvas;
    }

    const tileCanvas = this.canvas.ownerDocument.createElement("canvas");
    tileCanvas.width = tileSize;
    tileCanvas.height = tileSize;
    this.tileCanvasCache.set(key, tileCanvas);

    return tileCanvas;
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
}
