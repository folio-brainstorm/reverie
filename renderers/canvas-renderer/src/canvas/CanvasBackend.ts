import type { Camera, WorldBounds } from "@reverie/core";
import type {
  RenderRegion,
  RendererBackend,
  RenderRegionSet,
  RenderTarget,
} from "@reverie/core/renderer";

import { RendererErrorDefinitions } from "../errors/RendererErrorDefinitions.js";
import {
  RendererError,
  RendererRangeError,
  RendererTypeError,
} from "../errors/RendererErrors.js";
import type { CanvasRegionSurface } from "../interfaces/CanvasRegionSurface.js";

const CONTEXT_IDENTIFIER = "2d";

/** Presents final Core pixels through an HTML Canvas 2D target. */
export default class CanvasBackend implements RendererBackend {
  /** Canvas whose backing buffer receives each rendered frame. */
  readonly canvas: HTMLCanvasElement;

  /** Camera used only to project already-resolved region bounds to Canvas. */
  readonly camera: Camera;

  private readonly renderTarget: RenderTarget = {};
  private readonly context: CanvasRenderingContext2D;
  private readonly worldBounds: WorldBounds | null;
  private readonly regionSurfaces = new Map<string, CanvasRegionSurface>();
  private currentPixelRatio = 1;

  /** Backing pixels used for each CSS pixel in the current viewport. */
  get pixelRatio(): number {
    return this.currentPixelRatio;
  }

  /** Opaque target owned by this backend for its presentation calls. */
  get target(): RenderTarget {
    return this.renderTarget;
  }

  /**
   * Creates a Canvas output backend without retaining a Raster or World source.
   *
   * @param canvas - Canvas backing buffer that receives final pixels.
   * @param camera - Projection applied while drawing resolved region bounds.
   * @param worldBounds - Optional output clip copied from a World at construction.
   * @throws {RendererError} The Canvas cannot provide a 2D rendering context.
   */
  constructor(
    canvas: HTMLCanvasElement,
    camera: Camera,
    worldBounds: WorldBounds | null,
  ) {
    const context = canvas.getContext(CONTEXT_IDENTIFIER);
    if (context === null) {
      throw RendererError.from(
        RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
      );
    }
    this.canvas = canvas;
    this.camera = camera;
    this.context = context;
    this.worldBounds = worldBounds === null ? null : { ...worldBounds };
  }

  /**
   * Uploads final RGBA8 regions and draws them to the Canvas target.
   *
   * @param regions - Final Core output; this backend never reads Raster or World.
   * @param target - Backend-owned output target for this presentation pass.
   */
  present(regions: RenderRegionSet, _target: RenderTarget): void {
    const { width, height } = this.canvas;
    const effectiveScale = this.camera.zoom * this.currentPixelRatio;
    const shouldSmooth = effectiveScale < 1;

    this.context.clearRect(0, 0, width, height);
    this.context.imageSmoothingEnabled = shouldSmooth;
    if (shouldSmooth) {
      this.context.imageSmoothingQuality = "high";
    }
    if (width === 0 || height === 0 || regions.regions.length === 0) {
      return;
    }

    this.context.save();
    try {
      this.context.globalAlpha = 1;
      this.context.globalCompositeOperation = "source-over";
      this.clipWorldBounds();
      for (const region of regions.regions) {
        this.presentRegion(region);
      }
    } finally {
      this.context.restore();
    }
  }

  /**
   * Changes the Canvas backing-buffer dimensions used as the screen viewport.
   *
   * @param width - Non-negative finite integer width in backing pixels.
   * @param height - Non-negative finite integer height in backing pixels.
   * @param pixelRatio - Positive finite backing pixels per CSS pixel.
   * @throws {RendererTypeError} A dimension or pixel ratio is not a number.
   * @throws {RendererRangeError} A supplied dimension or pixel ratio is invalid.
   */
  resize(width: number, height: number, pixelRatio = 1): void {
    CanvasBackend.assertValidCanvasSize(width, height);
    CanvasBackend.assertValidPixelRatio(pixelRatio);
    this.canvas.width = width;
    this.canvas.height = height;
    this.currentPixelRatio = pixelRatio;
  }

  /** Releases offscreen Canvas upload surfaces retained by this backend. */
  dispose(): void {
    this.regionSurfaces.clear();
  }

  /** Clips presentation to the immutable output bounds supplied by a World. */
  private clipWorldBounds(): void {
    if (this.worldBounds === null) {
      return;
    }
    const point = this.camera.worldToScreen(this.worldBounds);
    const scale = this.camera.zoom * this.currentPixelRatio;
    this.context.beginPath();
    this.context.rect(
      point.x * this.currentPixelRatio,
      point.y * this.currentPixelRatio,
      this.worldBounds.width * scale,
      this.worldBounds.height * scale,
    );
    this.context.clip();
  }

  /** Uploads and projects one already-composited pixel region. */
  private presentRegion(region: RenderRegion): void {
    const surface = this.getRegionSurface(region);
    if (
      !CanvasBackend.hasCurrentPixels(surface.imageData.data, region.pixels)
    ) {
      surface.imageData.data.set(region.pixels);
      surface.context.putImageData(surface.imageData, 0, 0);
    }

    const point = this.camera.worldToScreen(region.bounds);
    const scale = this.camera.zoom * this.currentPixelRatio;
    this.context.drawImage(
      surface.canvas,
      point.x * this.currentPixelRatio,
      point.y * this.currentPixelRatio,
      region.bounds.width * scale,
      region.bounds.height * scale,
    );
  }

  /** Returns a reusable Canvas upload surface matching one region's geometry. */
  private getRegionSurface(region: RenderRegion): CanvasRegionSurface {
    const size = CanvasBackend.resolvePixelSize(region);
    const key = `${region.bounds.x}:${region.bounds.y}:${region.bounds.width}:${region.bounds.height}:${size}`;
    const cached = this.regionSurfaces.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const canvas = this.canvas.ownerDocument.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext(CONTEXT_IDENTIFIER);
    if (context === null) {
      throw RendererError.from(
        RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
      );
    }
    const surface = {
      canvas,
      context,
      imageData: context.createImageData(size, size),
    };
    this.regionSurfaces.set(key, surface);
    return surface;
  }

  /** Resolves the square source dimensions encoded by one Core tile region. */
  private static resolvePixelSize(region: RenderRegion): number {
    return Math.sqrt(region.pixels.length / 4);
  }

  /** Avoids a Canvas upload when Core supplied byte-identical output again. */
  private static hasCurrentPixels(
    current: Uint8ClampedArray,
    next: Uint8Array,
  ): boolean {
    if (current.length !== next.length) {
      return false;
    }
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] !== next[index]) {
        return false;
      }
    }
    return true;
  }

  /** Validates both dimensions before resize mutates either Canvas property. */
  private static assertValidCanvasSize(width: unknown, height: unknown): void {
    if (typeof width !== "number" || typeof height !== "number") {
      throw RendererTypeError.from(
        RendererErrorDefinitions.INVALID_CANVAS_SIZE,
        { width: String(width), height: String(height) },
      );
    }
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 0 ||
      height < 0
    ) {
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
