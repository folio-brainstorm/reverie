import type {
  PixelCoord,
  PixelLocation,
} from "../../interfaces/pixel/PixelCoords.js";
import type { WorldConfig } from "../../interfaces/world/World.js";
import type { ResolvedWorldConfig } from "../../interfaces/world/ResolvedWorldConfig.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";
import type { LayerRemovalObserver } from "../../interfaces/world/LayerRemovalObserver.js";
import type { RasterLayerMutation } from "../../interfaces/world/RasterLayerMutation.js";
import type { WorldMutation } from "../../interfaces/world/WorldMutation.js";
import type { WorldMutationObserver } from "../../interfaces/world/WorldMutationObserver.js";
import type { WorldRasterStatistics } from "../../interfaces/world/WorldRasterStatistics.js";

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
import { createStableDocumentId } from "../../utils/document/CreateStableDocumentId.js";
import { isStableDocumentId } from "../../utils/document/IsStableDocumentId.js";
import {
  ReverieError,
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { CoordCoverter } from "../../utils/number/coords/CoordCoverter.js";
import { isValidCoord } from "../../utils/number/coords/isValidCoord.js";
import { isValidTileSize } from "../../utils/number/tile/IsValidTileSize.js";
import { isValidWorldBounds } from "../../utils/number/world/IsValidWorldBounds.js";
import { Raster } from "../raster/Raster.js";
import { RasterLayer } from "./RasterLayer.js";

const LAYER_OWNERS = new WeakMap<RasterLayer, World>();
const RASTER_OWNERS = new WeakMap<Raster, RasterLayer>();

/**
 * Owns a nonempty ordered Raster-layer document and its world-coordinate bounds.
 * Standalone Raster storage and coordinate conversion remain independent.
 */
export class World {
  /** Stable serializable identity for this document root. */
  readonly id: string;

  private readonly config: ResolvedWorldConfig;
  private orderedLayers: readonly RasterLayer[] = Object.freeze([]);
  private readonly removalObservers = new Set<LayerRemovalObserver>();
  private readonly mutationObservers = new Set<WorldMutationObserver>();
  private readonly layerMutationUnsubscribers = new Map<
    RasterLayer,
    () => void
  >();
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

  /** Returns the immutable square Raster tile edge length in document pixels. */
  get tileSize(): number {
    return this.config.tileSize;
  }

  /**
   * Returns aggregate sparse Raster-storage statistics for this World's Layers.
   *
   * The result is a query snapshot only: it does not include history, renderer,
   * GPU, or runtime-memory resources and does not subscribe to future changes.
   *
   * @returns Total raw Tile storage plus independent statistics for each Layer.
   */
  getRasterStatistics(): WorldRasterStatistics {
    const layers = this.layers.map((layer) => ({
      id: layer.id,
      statistics: layer.raster.getStatistics(),
    }));
    const tileCount = layers.reduce(
      (total, layer) => total + layer.statistics.tileCount,
      0,
    );
    const rawPixelBytes = layers.reduce(
      (total, layer) => total + layer.statistics.rawPixelBytes,
      0,
    );

    return { tileCount, rawPixelBytes, layers };
  }

  /**
   * Creates a world using explicit configuration or the current runtime defaults.
   *
   * An invalid runtime default is replaced with `DEFAULT_WORLD_TILE_SIZE` and
   * reported as a non-fatal diagnostic. An explicitly invalid size is rejected.
   *
   * @param config - Optional identity, tile size, document bounds, and reporter overrides.
   * @throws {ReverieTypeError} The optional document identity is invalid.
   * @throws {ReverieRangeError} Tile size or bounds are invalid.
   */
  constructor(config: WorldConfig = {}) {
    const id = config.id ?? createStableDocumentId("document");
    if (!isStableDocumentId(id)) {
      throw ReverieTypeError.from(
        ErrorDefinitions.DOCUMENT.INVALID_DOCUMENT_ID,
      );
    }
    this.id = id;
    const reporter =
      config.reporter ??
      defaultWorldConfig.reporter ??
      // #if DEBUG
      consoleDiagnosticReporter ??
      // #endif
      void 0;

    const bounds = config.bounds ?? null;

    if (bounds !== null && !isValidWorldBounds(bounds)) {
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
      this.addInitialLayers(config.initialLayers);
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
    this.addInitialLayers(config.initialLayers);
  }

  /** Establishes the required initial Layer set after immutable config resolves. */
  private addInitialLayers(
    initialLayers: readonly RasterLayer[] | undefined,
  ): void {
    if (initialLayers === undefined) {
      this.addLayer();
      return;
    }
    if (!Array.isArray(initialLayers)) {
      throw ReverieTypeError.from(ErrorDefinitions.WORLD.INCOMPATIBLE_LAYER);
    }
    if (initialLayers.length === 0) {
      throw ReverieRangeError.from(ErrorDefinitions.WORLD.EMPTY_INITIAL_LAYERS);
    }
    const registered: RasterLayer[] = [];
    const initialLayerNumber = this.nextLayerNumber;
    try {
      for (const layer of initialLayers) {
        this.addLayer(layer);
        registered.push(layer);
      }
    } catch (cause) {
      for (const layer of registered) {
        this.detachLayerMutationObservation(layer);
        LAYER_OWNERS.delete(layer);
        RASTER_OWNERS.delete(layer.raster);
      }
      this.orderedLayers = Object.freeze([]);
      this.nextLayerNumber = initialLayerNumber;
      throw cause;
    }
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
    if (this.layers.some((existing) => existing.id === candidate.id)) {
      throw ReverieError.from(ErrorDefinitions.DOCUMENT.DUPLICATE_LAYER_ID, {
        id: candidate.id,
      });
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
    const mutation: WorldMutation = {
      kind: "layer-inserted",
      layer: candidate,
      index,
    };
    this.notifyBeforeMutation(mutation);
    if (!candidate.hasAssignedName) {
      candidate.name = `Layer ${this.nextLayerNumber++}`;
    }
    const layers = [...this.layers];
    layers.splice(index, 0, candidate);
    LAYER_OWNERS.set(candidate, this);
    RASTER_OWNERS.set(candidate.raster, candidate);
    this.orderedLayers = Object.freeze(layers);
    this.attachLayerMutationObservation(candidate);
    this.notifyAfterMutation(mutation);
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
    const previousIndex = this.layers.indexOf(member);
    if (previousIndex === index) {
      return;
    }
    const mutation: WorldMutation = {
      kind: "layer-moved",
      layer: member,
      previousIndex,
      index,
    };
    this.notifyBeforeMutation(mutation);
    const layers = [...this.layers];
    layers.splice(previousIndex, 1);
    layers.splice(index, 0, member);
    this.orderedLayers = Object.freeze(layers);
    this.notifyAfterMutation(mutation);
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
    const mutation: WorldMutation = {
      kind: "layer-removed",
      layer: member,
      index,
    };
    const observers = [...this.removalObservers];
    this.isRemovingLayer = true;
    try {
      for (const observer of observers) {
        observer.beforeRemove?.(member);
      }
      this.notifyBeforeMutation(mutation);
      this.orderedLayers = Object.freeze(
        this.layers.filter((entry) => entry !== member),
      );
      this.detachLayerMutationObservation(member);
      LAYER_OWNERS.delete(member);
      RASTER_OWNERS.delete(member.raster);
      this.notifyAfterMutation(mutation);
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

  /**
   * Observes layer membership, order, and property mutations in this document.
   * Observation is optional; standalone Worlds retain no history state.
   *
   * @param observer - Hooks invoked around each validated document mutation.
   * @returns An idempotent function that stops this observer.
   */
  observeMutations(observer: WorldMutationObserver): () => void {
    const shouldAttachLayers = this.mutationObservers.size === 0;
    this.mutationObservers.add(observer);
    if (shouldAttachLayers) {
      for (const layer of this.layers) {
        this.attachLayerMutationObservation(layer);
      }
    }
    return () => {
      this.mutationObservers.delete(observer);
      if (this.mutationObservers.size === 0) {
        for (const layer of [...this.layerMutationUnsubscribers.keys()]) {
          this.detachLayerMutationObservation(layer);
        }
      }
    };
  }

  /** Rejects mutations from callbacks before any membership change is made. */
  private assertCanChangeLayers(): void {
    if (this.isRemovingLayer) {
      throw ReverieError.from(ErrorDefinitions.WORLD.REENTRANT_LAYER_CHANGE);
    }
  }

  /** Subscribes to one member Layer only while World observation is active. */
  private attachLayerMutationObservation(layer: RasterLayer): void {
    if (
      this.mutationObservers.size === 0 ||
      this.layerMutationUnsubscribers.has(layer)
    ) {
      return;
    }
    const unsubscribe = layer.observeMutations({
      beforeMutation: (mutation) => {
        this.notifyBeforeMutation(
          World.createLayerPropertyMutation(layer, mutation),
        );
      },
      afterMutation: (mutation) => {
        this.notifyAfterMutation(
          World.createLayerPropertyMutation(layer, mutation),
        );
      },
    });
    this.layerMutationUnsubscribers.set(layer, unsubscribe);
  }

  /** Stops forwarding mutations from one detached or unobserved Layer. */
  private detachLayerMutationObservation(layer: RasterLayer): void {
    this.layerMutationUnsubscribers.get(layer)?.();
    this.layerMutationUnsubscribers.delete(layer);
  }

  /** Invokes current validation observers before changing document state. */
  private notifyBeforeMutation(mutation: WorldMutation): void {
    for (const observer of [...this.mutationObservers]) {
      observer.beforeMutation?.(mutation);
    }
  }

  /** Invokes current recording observers after changing document state. */
  private notifyAfterMutation(mutation: WorldMutation): void {
    for (const observer of [...this.mutationObservers]) {
      observer.afterMutation?.(mutation);
    }
  }

  /** Maps one Layer-local property change into its World document mutation. */
  private static createLayerPropertyMutation(
    layer: RasterLayer,
    mutation: RasterLayerMutation,
  ): WorldMutation {
    switch (mutation.kind) {
      case "name":
        return {
          kind: "layer-name-changed",
          layer,
          previousValue: mutation.previousValue,
          value: mutation.value,
        };
      case "visibility":
        return {
          kind: "layer-visibility-changed",
          layer,
          previousValue: mutation.previousValue,
          value: mutation.value,
        };
      case "opacity":
        return {
          kind: "layer-opacity-changed",
          layer,
          previousValue: mutation.previousValue,
          value: mutation.value,
        };
      case "blend-mode":
        return {
          kind: "layer-blend-mode-changed",
          layer,
          previousValue: mutation.previousValue,
          value: mutation.value,
        };
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

}
