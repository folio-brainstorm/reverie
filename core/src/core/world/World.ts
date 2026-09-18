import type {
  PixelCoord,
  PixelLocation,
} from "../../interfaces/pixel/PixelCoords.js";
import type { WorldConfig } from "../../interfaces/world/World.js";
import type { ResolvedWorldConfig } from "../../interfaces/world/ResolvedWorldConfig.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";
import type { LayerRemovalObserver } from "../../interfaces/world/LayerRemovalObserver.js";

import {
  DEFAULT_WORLD_TILE_SIZE,
  defaultWorldConfig,
} from "../../config/DefaultWorldConfig.js";
import { DiagnosticDefinitions } from "../../utils/diagnostic/DiagnosticDefinitions.js";
import { reportDiagnostic } from "../../utils/diagnostic/Diagnostics.js";
// #if DEBUG
import { consoleDiagnosticReporter } from "../../utils/diagnostic/Diagnostics.js";
// #endif
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import {
  ReverieError,
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { CoordCoverter } from "../../utils/number/coords/CoordCoverter.js";
import { isValidCoord } from "../../utils/number/coords/isValidCoord.js";
import { isValidTileSize } from "../../utils/number/tile/IsValidTileSize.js";
import { Raster } from "../raster/Raster.js";
import { RasterLayer } from "./RasterLayer.js";

const LAYER_OWNERS = new WeakMap<RasterLayer, World>();
const RASTER_OWNERS = new WeakMap<Raster, RasterLayer>();

/**
 * Owns a nonempty ordered Raster-layer document and its world-coordinate bounds.
 * Standalone Raster storage and coordinate conversion remain independent.
 */
export class World {
  private readonly config: ResolvedWorldConfig;
  private orderedLayers: readonly RasterLayer[] = Object.freeze([]);
  private readonly removalObservers = new Set<LayerRemovalObserver>();
  private isRemovingLayer = false;
  private nextLayerNumber = 1;

  /** Immutable collection snapshot, ordered from bottom to top. */
  get layers(): readonly RasterLayer[] {
    return this.orderedLayers;
  }

  /** Returns a defensive copy of the finite bounds, or `null` when unbounded. */
  get bounds(): WorldBounds | null {
    const bounds = this.config.bounds;
    return bounds === null ? null : { ...bounds };
  }

  /**
   * Creates a world using explicit configuration or the current runtime defaults.
   *
   * An invalid runtime default is replaced with `DEFAULT_WORLD_TILE_SIZE` and
   * reported as a non-fatal diagnostic. An explicitly invalid size is rejected.
   *
   * @param config - Optional tile size, document bounds, and reporter overrides.
   * @throws {ReverieRangeError} Tile size or bounds are invalid.
   */
  constructor(config: WorldConfig = {}) {
    const reporter =
      config.reporter ??
      defaultWorldConfig.reporter ??
      // #if DEBUG
      consoleDiagnosticReporter ??
      // #endif
      void 0;

    const bounds = config.bounds ?? null;

    if (bounds !== null && !World.isValidBounds(bounds)) {
      throw ReverieRangeError.from(ErrorDefinitions.WORLD.INVALID_BOUNDS);
    }

    const ownedBounds = bounds === null ? null : { ...bounds };

    if (config.tileSize !== undefined) {
      if (!isValidTileSize(config.tileSize)) {
        throw ReverieRangeError.from(ErrorDefinitions.COMMON.UNSAFE_TILE_SIZE, {
          tileSize: config.tileSize,
        });
      }

      this.config = {
        tileSize: config.tileSize,
        bounds: ownedBounds,
        reporter,
      };
      this.addLayer();
      return;
    }

    let tileSize = defaultWorldConfig.tileSize;

    if (!isValidTileSize(tileSize)) {
      reportDiagnostic(
        reporter,
        DiagnosticDefinitions.WORLD.INVALID_DEFAULT_TILE_SIZE,
        {
          tileSize,
          fallbackTileSize: DEFAULT_WORLD_TILE_SIZE,
        },
      );
      tileSize = DEFAULT_WORLD_TILE_SIZE;
    }

    this.config = { tileSize, bounds: ownedBounds, reporter };
    this.addLayer();
  }

  /**
   * Reports whether a valid world pixel lies inside this World's bounds.
   *
   * @param pixel - Safe-integer world-pixel coordinate to test.
   * @returns `true` for every valid pixel in an unbounded World, otherwise
   * whether the pixel lies in the finite half-open region.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   */
  containsPixel(pixel: PixelCoord): boolean {
    if (!isValidCoord(pixel)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.UNSAFE_COORDINATE_VALUE,
        pixel,
      );
    }

    const bounds = this.config.bounds;

    if (bounds === null) {
      return true;
    }

    return (
      pixel.x >= bounds.x &&
      pixel.x - bounds.x < bounds.width &&
      pixel.y >= bounds.y &&
      pixel.y - bounds.y < bounds.height
    );
  }

  /**
   * Creates a Raster layer sharing this World's tile size and paint bounds.
   *
   * @returns A new empty layer whose direct Raster remains unbounded while
   * layer-level Brush stamps are clipped to this World.
   */
  createRasterLayer(): RasterLayer {
    return new RasterLayer(
      new Raster({ tileSize: this.config.tileSize }),
      this.config.bounds,
    );
  }

  /**
   * Appends a compatible layer, or creates a new empty layer at the top.
   * @param layer - Optional detached layer with matching tile size and bounds.
   * @returns The registered layer.
   * @throws {ReverieError} The layer or its Raster is already owned, or removal is in progress.
   * @throws {ReverieTypeError} The layer type or geometry is incompatible.
   */
  addLayer(layer?: RasterLayer): RasterLayer {
    return this.insertLayer(this.layers.length, layer);
  }

  /**
   * Inserts a detached layer at a bottom-to-top position.
   * @param index - Safe integer from zero through the current layer count.
   * @param layer - Optional compatible detached layer; omission creates an empty one.
   * @returns The registered layer, without changing its Raster pixels.
   * @throws {ReverieRangeError} The insertion index is invalid.
   * @throws {ReverieError} The layer or its Raster is already owned, or removal is in progress.
   * @throws {ReverieTypeError} The layer type or geometry is incompatible.
   */
  insertLayer(index: number, layer?: RasterLayer): RasterLayer {
    this.assertCanChangeLayers();
    this.assertLayerIndex(index, true);
    const candidate = layer === undefined ? this.createRasterLayer() : layer;
    if (!(candidate instanceof RasterLayer)) {
      throw ReverieTypeError.from(ErrorDefinitions.WORLD.INCOMPATIBLE_LAYER);
    }
    if (LAYER_OWNERS.has(candidate) || RASTER_OWNERS.has(candidate.raster)) {
      throw ReverieError.from(ErrorDefinitions.WORLD.DUPLICATE_LAYER_OWNERSHIP);
    }
    const bounds = candidate.bounds;
    const expected = this.config.bounds;
    const hasMatchingBounds =
      bounds === null
        ? expected === null
        : expected !== null &&
          bounds.x === expected.x &&
          bounds.y === expected.y &&
          bounds.width === expected.width &&
          bounds.height === expected.height;
    if (
      candidate.raster.tileSize !== this.config.tileSize ||
      !hasMatchingBounds
    ) {
      throw ReverieTypeError.from(ErrorDefinitions.WORLD.INCOMPATIBLE_LAYER);
    }
    if (!candidate.hasAssignedName) {
      candidate.name = `Layer ${this.nextLayerNumber++}`;
    }
    const layers = [...this.layers];
    layers.splice(index, 0, candidate);
    LAYER_OWNERS.set(candidate, this);
    RASTER_OWNERS.set(candidate.raster, candidate);
    this.orderedLayers = Object.freeze(layers);
    return candidate;
  }

  /**
   * Returns a registered layer by position or reference.
   * @param layer - Safe-integer index or member layer reference.
   * @returns The matching layer.
   * @throws {ReverieRangeError} The index is not a member position.
   * @throws {ReverieError} The layer reference is not a member.
   */
  getLayer(layer: number | RasterLayer): RasterLayer {
    if (typeof layer !== "number") {
      if (!this.layers.includes(layer)) {
        throw ReverieError.from(ErrorDefinitions.WORLD.LAYER_NOT_FOUND);
      }
      return layer;
    }
    if (!Number.isSafeInteger(layer) || layer < 0) {
      throw ReverieRangeError.from(ErrorDefinitions.WORLD.INVALID_LAYER_INDEX);
    }
    // The checked lookup both rejects positions beyond the collection and
    // narrows indexed access without an unchecked non-null assertion.
    const result = this.layers[layer];
    if (result === undefined) {
      throw ReverieRangeError.from(ErrorDefinitions.WORLD.INVALID_LAYER_INDEX);
    }
    return result;
  }

  /**
   * Moves a member to its final position without modifying pixel data.
   * @param layer - Member reference or current index.
   * @param index - Final index in the unchanged-length collection.
   * @throws {ReverieRangeError} Either position is invalid.
   * @throws {ReverieError} The reference is not a member, or removal is in progress.
   */
  moveLayer(layer: number | RasterLayer, index: number): void {
    this.assertCanChangeLayers();
    const member = this.getLayer(layer);
    this.assertLayerIndex(index);
    const layers = [...this.layers];
    layers.splice(layers.indexOf(member), 1);
    layers.splice(index, 0, member);
    this.orderedLayers = Object.freeze(layers);
  }

  /**
   * Detaches a layer while preserving its storage and the nonempty invariant.
   * @param layer - Member reference or index.
   * @returns The removed layer, eligible for insertion into a compatible World.
   * @throws {ReverieRangeError} The index is invalid or this is the final layer.
   * @throws {ReverieError} The reference is not a member, or removal is in progress.
   * @throws A registered before-removal observer rejects the operation.
   */
  removeLayer(layer: number | RasterLayer): RasterLayer {
    this.assertCanChangeLayers();
    const member = this.getLayer(layer);
    if (this.layers.length === 1) {
      throw ReverieRangeError.from(ErrorDefinitions.WORLD.LAST_LAYER_REMOVAL);
    }
    const index = this.layers.indexOf(member);
    const observers = [...this.removalObservers];
    this.isRemovingLayer = true;
    try {
      for (const observer of observers) {
        observer.beforeRemove?.(member);
      }
      this.orderedLayers = Object.freeze(
        this.layers.filter((entry) => entry !== member),
      );
      LAYER_OWNERS.delete(member);
      RASTER_OWNERS.delete(member.raster);
      for (const observer of observers) {
        observer.afterRemove?.(member, index);
      }
    } finally {
      try {
        for (const observer of observers) {
          observer.afterRemovalAttempt?.();
        }
      } finally {
        this.isRemovingLayer = false;
      }
    }
    return member;
  }

  /**
   * Observes removals so external sessions can validate and repair retained references.
   * Callbacks must not change layer membership/order. Post-removal and attempt
   * cleanup callbacks must not throw; cleanup runs even when validation rejects removal.
   * @param observer - Validation and post-removal hooks, independent of editor state.
   * @returns An idempotent unsubscribe function.
   */
  observeLayerRemoval(observer: LayerRemovalObserver): () => void {
    this.removalObservers.add(observer);
    return () => {
      this.removalObservers.delete(observer);
    };
  }

  /** Rejects mutations from callbacks before any membership change is made. */
  private assertCanChangeLayers(): void {
    if (this.isRemovingLayer) {
      throw ReverieError.from(ErrorDefinitions.WORLD.REENTRANT_LAYER_CHANGE);
    }
  }

  /** Validates collection positions without silently rounding or clamping. */
  private assertLayerIndex(index: number, canAppend = false): void {
    const limit = this.layers.length + (canAppend ? 1 : 0);
    if (!Number.isSafeInteger(index) || index < 0 || index >= limit) {
      throw ReverieRangeError.from(ErrorDefinitions.WORLD.INVALID_LAYER_INDEX);
    }
  }

  /**
   * Resolves a world pixel into its containing tile and tile-local coordinate.
   *
   * World coordinates may be negative, but both components must be safe integers.
   *
   * @param coord - The world-pixel coordinate to resolve.
   * @returns The containing tile coordinate and zero-based local pixel coordinate.
   * @throws {ReverieTypeError} A coordinate component is not a number.
   * @throws {ReverieRangeError} A coordinate component is not a safe integer.
   */
  locatePixel(coord: PixelCoord): PixelLocation {
    if (!isValidCoord(coord)) {
      throw ReverieRangeError.from(
        ErrorDefinitions.COMMON.UNSAFE_COORDINATE_VALUE,
        coord,
      );
    }

    return CoordCoverter.World.locateWorldPixel(coord, this.config.tileSize);
  }

  /** Determines whether a candidate is a valid finite World region. */
  private static isValidBounds(bounds: unknown): bounds is WorldBounds {
    if (typeof bounds !== "object" || bounds === null) {
      return false;
    }

    if (
      !("x" in bounds) ||
      !("y" in bounds) ||
      !("width" in bounds) ||
      !("height" in bounds)
    ) {
      return false;
    }

    return (
      typeof bounds.x === "number" &&
      Number.isSafeInteger(bounds.x) &&
      typeof bounds.y === "number" &&
      Number.isSafeInteger(bounds.y) &&
      typeof bounds.width === "number" &&
      Number.isSafeInteger(bounds.width) &&
      bounds.width > 0 &&
      typeof bounds.height === "number" &&
      Number.isSafeInteger(bounds.height) &&
      bounds.height > 0
    );
  }
}
