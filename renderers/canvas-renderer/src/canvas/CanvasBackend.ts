import type { View, WorldBounds, WorldRect } from "@reveriejs/core";
import type { RenderRegion, RenderTarget } from "@reveriejs/core/rendering";

import { RendererErrorDefinitions } from "../errors/RendererErrorDefinitions.js";
import {
  RendererError,
  RendererRangeError,
  RendererTypeError,
} from "../errors/RendererErrors.js";
import type { CanvasRegionSurface } from "../interfaces/CanvasRegionSurface.js";
import type { CanvasDeviceBounds } from "../interfaces/CanvasDeviceBounds.js";
import type { PresentationFrame } from "../interfaces/presentation/PresentationFrame.js";
import CanvasDiagnostics from "./CanvasDiagnostics.js";

const CONTEXT_IDENTIFIER = "2d";

/** Presents final Core pixels through an HTML Canvas 2D target. */
export default class CanvasBackend {
  /** Canvas whose backing buffer receives each rendered frame. */
  readonly canvas: HTMLCanvasElement;

  /** Camera used only to project already-resolved region bounds to Canvas. */
  readonly camera: View;

  private readonly renderTarget: RenderTarget = {};
  private readonly context: CanvasRenderingContext2D;
  private readonly worldBounds: WorldBounds | null;
  private readonly diagnostics: CanvasDiagnostics;
  private readonly regionSurfaces = new Map<string, CanvasRegionSurface>();
  private currentPixelRatio = 1;
  private readonly rotatedRegions = new Map<string, RenderRegion>();
  private compositionCanvas: HTMLCanvasElement | null = null;

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
    camera: View,
    worldBounds: WorldBounds | null,
    diagnostics: CanvasDiagnostics,
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
    this.diagnostics = diagnostics;
  }

  /**
   * Uploads final RGBA8 regions and draws them to the Canvas target.
   *
   * @param frame - Validated complete frame; this backend never reads Raster or World.
   * @param target - Backend-owned output target for this presentation pass.
   */
  present(frame: PresentationFrame, _target: RenderTarget): void {
    if (this.camera.rotation !== 0) {
      this.rotatedRegions.clear();
      this.presentRegions(frame.regions);
      return;
    }
    const startedAt = this.diagnostics.hasTimings ? performance.now() : 0;
    const { width, height } = this.canvas;

    this.context.clearRect(0, 0, width, height);
    this.configureSmoothing();
    if (width === 0 || height === 0 || frame.regions.length === 0) {
      if (this.diagnostics.hasTimings) {
        this.diagnostics.recordPresentation(performance.now() - startedAt);
      }
      return;
    }

    this.context.save();
    try {
      this.context.globalAlpha = 1;
      this.context.globalCompositeOperation = "source-over";
      this.clipWorldBounds();
      for (const region of frame.regions) {
        this.presentRegion(region);
      }
    } finally {
      this.context.restore();
      if (this.diagnostics.hasTimings) {
        this.diagnostics.recordPresentation(performance.now() - startedAt);
      }
    }
  }

  /** Replaces only regions supplied by a progressive Core batch. */
  presentRegions(regions: readonly RenderRegion[]): void {
    if (this.camera.rotation !== 0) {
      for (const region of regions)
        this.rotatedRegions.set(CanvasBackend.boundsKey(region.bounds), region);
      this.presentRotated();
      return;
    }
    const startedAt = this.diagnostics.hasTimings ? performance.now() : 0;
    this.configureSmoothing();
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      if (this.diagnostics.hasTimings) {
        this.diagnostics.recordPresentation(performance.now() - startedAt);
      }
      return;
    }
    this.context.save();
    try {
      this.context.globalAlpha = 1;
      this.context.globalCompositeOperation = "source-over";
      this.clipWorldBounds();
      for (const region of regions) {
        this.clearSnappedBounds(region.bounds);
      }
      for (const region of regions) {
        this.presentRegion(region);
      }
    } finally {
      this.context.restore();
      if (this.diagnostics.hasTimings) {
        this.diagnostics.recordPresentation(performance.now() - startedAt);
      }
    }
  }

  /** Clears coverage omitted by a completed replacement without uploading pixels. */
  clearRegions(bounds: readonly WorldRect[]): void {
    if (this.camera.rotation !== 0) {
      for (const region of bounds)
        this.rotatedRegions.delete(CanvasBackend.boundsKey(region));
      this.presentRotated();
      return;
    }
    if (
      bounds.length === 0 ||
      this.canvas.width === 0 ||
      this.canvas.height === 0
    ) {
      return;
    }
    const startedAt = this.diagnostics.hasTimings ? performance.now() : 0;
    this.context.save();
    try {
      this.clipWorldBounds();
      for (const region of bounds) {
        this.clearSnappedBounds(region);
      }
    } finally {
      this.context.restore();
      if (this.diagnostics.hasTimings) {
        this.diagnostics.recordPresentation(performance.now() - startedAt);
      }
    }
  }

  /** Clears the output when an operation invalidates every cached region. */
  clear(): void {
    this.rotatedRegions.clear();
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    const startedAt = this.diagnostics.hasTimings ? performance.now() : 0;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.configureSmoothing();
    if (this.diagnostics.hasTimings) {
      this.diagnostics.recordPresentation(performance.now() - startedAt);
    }
  }

  /** Keeps progressive and full-frame draws on the same sampling policy. */
  private configureSmoothing(): void {
    const shouldSmooth = this.camera.zoom * this.currentPixelRatio < 1;
    this.context.imageSmoothingEnabled = shouldSmooth;
    if (shouldSmooth) {
      this.context.imageSmoothingQuality = "high";
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
    this.rotatedRegions.clear();
    this.compositionCanvas = null;
  }

  /**
   * Releases upload surfaces after their Tile leaves the retention boundary.
   * @param viewport - Current camera area in world pixels.
   * @param margin - Retention distance in world pixels on each side.
   */
  retainNear(viewport: WorldRect, margin: number): void {
    for (const [key, surface] of this.regionSurfaces) {
      const bounds = surface.bounds;
      if (
        bounds.x >= viewport.x + viewport.width + margin ||
        bounds.x + bounds.width <= viewport.x - margin ||
        bounds.y >= viewport.y + viewport.height + margin ||
        bounds.y + bounds.height <= viewport.y - margin
      ) {
        this.regionSurfaces.delete(key);
      }
    }
  }

  /** Clips presentation to the immutable output bounds supplied by a World. */
  private clipWorldBounds(): void {
    if (this.worldBounds === null) {
      return;
    }
    const bounds = this.projectDeviceBounds(this.worldBounds);
    this.context.beginPath();
    this.context.rect(
      bounds.left,
      bounds.top,
      bounds.right - bounds.left,
      bounds.bottom - bounds.top,
    );
    this.context.clip();
  }

  /** Projects each shared world edge independently into backing pixels. */
  private projectDeviceBounds(bounds: WorldRect): CanvasDeviceBounds {
    const scale = this.camera.zoom * this.currentPixelRatio;
    return {
      left: (bounds.x - this.camera.panX) * scale,
      top: (bounds.y - this.camera.panY) * scale,
      right: (bounds.x + bounds.width - this.camera.panX) * scale,
      bottom: (bounds.y + bounds.height - this.camera.panY) * scale,
    };
  }

  /** Snaps shared edges, so adjacent regions derive exactly matching edges. */
  private projectSnappedBounds(bounds: WorldRect): CanvasDeviceBounds {
    const projected = this.projectDeviceBounds(bounds);
    return {
      left: CanvasBackend.snapDeviceBoundary(projected.left),
      top: CanvasBackend.snapDeviceBoundary(projected.top),
      right: CanvasBackend.snapDeviceBoundary(projected.right),
      bottom: CanvasBackend.snapDeviceBoundary(projected.bottom),
    };
  }

  /** Rounds ties away from zero to keep negative positions symmetric. */
  private static snapDeviceBoundary(value: number): number {
    return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
  }

  /** Clears the same snapped area used to draw a region. */
  private clearSnappedBounds(bounds: WorldRect): void {
    const device = this.projectSnappedBounds(bounds);
    const width = device.right - device.left;
    const height = device.bottom - device.top;
    if (width <= 0 || height <= 0) {
      return;
    }
    this.context.clearRect(device.left, device.top, width, height);
  }

  /** Uploads and projects one already-composited pixel region. */
  private presentRegion(
    region: RenderRegion,
    context: CanvasRenderingContext2D = this.context,
    device: CanvasDeviceBounds = this.projectSnappedBounds(region.bounds),
  ): void {
    const width = device.right - device.left;
    const height = device.bottom - device.top;
    if (width <= 0 || height <= 0) {
      return;
    }
    const surface = this.getRegionSurface(region);
    if (surface.lastValidatedPixels === region.pixels) {
      this.diagnostics.recordIdentityReuse();
    } else {
      const hasSamePixels = CanvasBackend.hasCurrentPixels(
        surface.imageData.data,
        region.pixels,
        this.diagnostics,
      );
      if (!hasSamePixels) {
        const uploadStartedAt = this.diagnostics.hasTimings
          ? performance.now()
          : 0;
        surface.imageData.data.set(region.pixels);
        surface.context.putImageData(surface.imageData, 0, 0);
        this.diagnostics.recordUpload(
          this.diagnostics.hasTimings ? performance.now() - uploadStartedAt : 0,
        );
      }
      surface.lastValidatedPixels = region.pixels;
    }

    const drawStartedAt = this.diagnostics.hasTimings ? performance.now() : 0;
    context.drawImage(surface.canvas, device.left, device.top, width, height);
    this.diagnostics.recordPresented(1);
    if (this.diagnostics.hasTimings) {
      this.diagnostics.recordDraw(performance.now() - drawStartedAt);
    }
  }

  /** Rebuilds a seam-free world-aligned image before projecting it once. */
  private presentRotated(): void {
    this.context.setTransform(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.canvas.width === 0 || this.canvas.height === 0) return;
    const scale = this.camera.zoom * this.pixelRatio;
    const bounds = this.camera.visibleWorldBounds({
      width: this.canvas.width / this.pixelRatio,
      height: this.canvas.height / this.pixelRatio,
    });
    const left = Math.floor(bounds.x * scale);
    const top = Math.floor(bounds.y * scale);
    const width = Math.ceil((bounds.x + bounds.width) * scale) - left;
    const height = Math.ceil((bounds.y + bounds.height) * scale) - top;
    const canvas =
      this.compositionCanvas ??
      this.canvas.ownerDocument.createElement("canvas");
    this.compositionCanvas = canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext(CONTEXT_IDENTIFIER);
    if (context === null)
      throw RendererError.from(
        RendererErrorDefinitions.FAILED_TO_ACQUIRE_RENDERING_CONTEXT,
      );
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = scale < 1;
    context.imageSmoothingQuality = "high";
    for (const region of this.rotatedRegions.values()) {
      const r = region.bounds;
      this.presentRegion(region, context, {
        left: CanvasBackend.snapDeviceBoundary(r.x * scale) - left,
        top: CanvasBackend.snapDeviceBoundary(r.y * scale) - top,
        right: CanvasBackend.snapDeviceBoundary((r.x + r.width) * scale) - left,
        bottom:
          CanvasBackend.snapDeviceBoundary((r.y + r.height) * scale) - top,
      });
    }
    const matrix = this.camera.getTransform();
    const ratio = this.pixelRatio;
    this.context.save();
    try {
      this.context.setTransform(
        matrix.a * ratio,
        matrix.b * ratio,
        matrix.c * ratio,
        matrix.d * ratio,
        matrix.e * ratio,
        matrix.f * ratio,
      );
      this.context.globalAlpha = 1;
      this.context.globalCompositeOperation = "source-over";
      this.context.imageSmoothingEnabled = false;
      if (this.worldBounds !== null) {
        this.context.beginPath();
        this.context.rect(
          this.worldBounds.x,
          this.worldBounds.y,
          this.worldBounds.width,
          this.worldBounds.height,
        );
        this.context.clip();
      }
      this.context.drawImage(
        canvas,
        left / scale,
        top / scale,
        width / scale,
        height / scale,
      );
    } finally {
      this.context.restore();
    }
  }

  /** Identifies the active placement independently of raster resolution. */
  private static boundsKey(bounds: WorldRect): string {
    return `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
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
      bounds: region.bounds,
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
    diagnostics: CanvasDiagnostics,
  ): boolean {
    if (current.length !== next.length) {
      diagnostics.recordPixelComparison(0);
      return false;
    }
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] !== next[index]) {
        diagnostics.recordPixelComparison(index + 1);
        return false;
      }
    }
    diagnostics.recordPixelComparison(current.length);
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
