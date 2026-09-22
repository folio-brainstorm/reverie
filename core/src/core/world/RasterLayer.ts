import type { Brush } from "../../interfaces/brush/Brush.js";
import type { WorldPoint } from "../../interfaces/camera/WorldPoint.js";
import type { StampCommand } from "../../interfaces/stroke/StampCommand.js";
import type { WorldBounds } from "../../interfaces/world/WorldBounds.js";
import type { LayerBlendMode } from "../../interfaces/world/LayerBlendMode.js";
import type { RasterLayerMutation } from "../../interfaces/world/RasterLayerMutation.js";
import type { RasterLayerMutationObserver } from "../../interfaces/world/RasterLayerMutationObserver.js";
import type { SelectionMask } from "../selection/SelectionMask.js";

import { RasterPaintTarget } from "../../internal/paint-target/RasterPaintTarget.js";
import { ErrorDefinitions } from "../../utils/errors/ErrorDefinitions.js";
import { createStableDocumentId } from "../../utils/document/CreateStableDocumentId.js";
import { isStableDocumentId } from "../../utils/document/IsStableDocumentId.js";
import {
  ReverieRangeError,
  ReverieTypeError,
} from "../../utils/errors/ReverieErrors.js";
import { Raster } from "../raster/Raster.js";
import { isLayerBlendMode } from "./IsLayerBlendMode.js";

/** Owns an unbounded Raster and applies its World's bounds while painting. */
export class RasterLayer {
  /** Stable serializable identity, independent of array position and Tile IDs. */
  readonly id: string;

  /** Descriptive metadata, independent of rendering. */
  private assignedName: string | undefined;

  /** Optional document observers installed only while a controller needs them. */
  private readonly mutationObservers = new Set<RasterLayerMutationObserver>();

  /** Returns descriptive metadata, or the detached unnamed default. */
  get name(): string {
    return this.assignedName ?? "Layer";
  }

  /** Assigns a name explicitly, including the literal default or an empty name. */
  set name(value: string) {
    const previousValue = this.name;
    if (value === previousValue && this.assignedName !== undefined) {
      return;
    }
    const mutation: RasterLayerMutation = {
      kind: "name",
      previousValue,
      value,
    };
    this.notifyBeforeMutation(mutation);
    this.assignedName = value;
    this.notifyAfterMutation(mutation);
  }

  /** Whether a caller or World has assigned a name, independent of its text. */
  get hasAssignedName(): boolean {
    return this.assignedName !== undefined;
  }
  private currentVisibility = true;
  private currentOpacity = 1;
  private currentBlendMode: LayerBlendMode = "normal";

  /** Whether this layer participates in composition. */
  get visible(): boolean {
    return this.currentVisibility;
  }

  /** Changes whether this layer contributes to World composition. */
  set visible(value: boolean) {
    const previousValue = this.currentVisibility;
    if (value === previousValue) {
      return;
    }
    const mutation: RasterLayerMutation = {
      kind: "visibility",
      previousValue,
      value,
    };
    this.notifyBeforeMutation(mutation);
    this.currentVisibility = value;
    this.notifyAfterMutation(mutation);
  }

  /** Non-destructive composition opacity in the inclusive range [0, 1]. */
  get opacity(): number {
    return this.currentOpacity;
  }

  /**
   * Changes composition opacity without rewriting Raster pixels.
   * @throws {ReverieRangeError} The value is not finite or lies outside [0, 1].
   */
  set opacity(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw ReverieRangeError.from(
        ErrorDefinitions.WORLD.INVALID_LAYER_OPACITY,
      );
    }
    const previousValue = this.currentOpacity;
    if (value === previousValue) {
      return;
    }
    const mutation: RasterLayerMutation = {
      kind: "opacity",
      previousValue,
      value,
    };
    this.notifyBeforeMutation(mutation);
    this.currentOpacity = value;
    this.notifyAfterMutation(mutation);
  }

  /** Blend operation used when this layer is composed into its World. */
  get blendMode(): LayerBlendMode {
    return this.currentBlendMode;
  }

  /**
   * Changes composition mode without rewriting Raster pixels.
   * @throws {ReverieTypeError} The value is not a supported blend mode.
   */
  set blendMode(value: LayerBlendMode) {
    if (!isLayerBlendMode(value)) {
      throw ReverieTypeError.from(
        ErrorDefinitions.WORLD.INVALID_LAYER_BLEND_MODE,
      );
    }
    const previousValue = this.currentBlendMode;
    if (value === previousValue) {
      return;
    }
    const mutation: RasterLayerMutation = {
      kind: "blend-mode",
      previousValue,
      value,
    };
    this.notifyBeforeMutation(mutation);
    this.currentBlendMode = value;
    this.notifyAfterMutation(mutation);
  }
  /** Sparse pixel storage owned by this layer. */
  readonly raster: Raster;

  private readonly paintTarget: RasterPaintTarget;
  private readonly internalBounds: WorldBounds | null;

  /** Returns a defensive copy of this layer's effective World bounds. */
  get bounds(): WorldBounds | null {
    return this.internalBounds === null ? null : { ...this.internalBounds };
  }

  /**
   * Creates a layer for a World-owned Raster and clipping region.
   *
   * Applications normally obtain layers through {@link World.createRasterLayer}.
   *
   * @param raster - Unbounded sparse storage owned by the layer.
   * @param bounds - Effective World bounds, or `null` when unbounded.
   * @param id - Stable identity to preserve during future document hydration.
   * @throws {ReverieTypeError} The supplied identifier is empty or not text.
   */
  constructor(raster: Raster, bounds: WorldBounds | null, id?: string) {
    const resolvedId = id ?? createStableDocumentId("layer");
    if (!isStableDocumentId(resolvedId)) {
      throw ReverieTypeError.from(
        ErrorDefinitions.DOCUMENT.INVALID_DOCUMENT_ID,
      );
    }
    this.id = resolvedId;
    this.raster = raster;
    this.internalBounds = bounds === null ? null : { ...bounds };
    this.paintTarget = new RasterPaintTarget(raster, this.internalBounds);
  }

  /**
   * Observes validated property mutations without making history mandatory.
   *
   * @param observer - Hooks invoked immediately before and after each change.
   * @returns An idempotent function that stops this observer.
   */
  observeMutations(observer: RasterLayerMutationObserver): () => void {
    this.mutationObservers.add(observer);
    return () => {
      this.mutationObservers.delete(observer);
    };
  }

  /**
   * Paints one stamp while clipping final pixel writes to effective bounds.
   *
   * @param brush - Brush used to produce the stamp.
   * @param position - Continuous world-space stamp center.
   * @param input - Optional per-stamp input forwarded without interpretation.
   * @param selection - Optional transient coverage mask independent of this Layer.
   */
  stamp(
    brush: Brush,
    position: WorldPoint,
    input?: StampCommand,
    selection: SelectionMask | null = null,
  ): void {
    this.paintTarget.stamp(brush, position, input, selection);
  }

  /**
   * Removes every allocated Tile while preserving this Layer and its metadata.
   *
   * Callers that require Undo should execute this operation inside their
   * existing Raster history transaction.
   */
  clear(): void {
    this.raster.clear();
  }

  /** Invokes current validation observers before changing a property. */
  private notifyBeforeMutation(mutation: RasterLayerMutation): void {
    for (const observer of [...this.mutationObservers]) {
      observer.beforeMutation?.(mutation);
    }
  }

  /** Invokes current recording observers after changing a property. */
  private notifyAfterMutation(mutation: RasterLayerMutation): void {
    for (const observer of [...this.mutationObservers]) {
      observer.afterMutation?.(mutation);
    }
  }
}
