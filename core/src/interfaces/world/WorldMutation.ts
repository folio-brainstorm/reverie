import type { RasterLayer } from "../../core/world/RasterLayer.js";
import type { LayerBlendMode } from "./LayerBlendMode.js";

/** Describes one committed mutation to a World-owned Layer document. */
export type WorldMutation =
  | {
      readonly kind: "layer-inserted";
      readonly layer: RasterLayer;
      readonly index: number;
    }
  | {
      readonly kind: "layer-removed";
      readonly layer: RasterLayer;
      readonly index: number;
    }
  | {
      readonly kind: "layer-moved";
      readonly layer: RasterLayer;
      readonly previousIndex: number;
      readonly index: number;
    }
  | {
      readonly kind: "layer-name-changed";
      readonly layer: RasterLayer;
      readonly previousValue: string;
      readonly value: string;
    }
  | {
      readonly kind: "layer-visibility-changed";
      readonly layer: RasterLayer;
      readonly previousValue: boolean;
      readonly value: boolean;
    }
  | {
      readonly kind: "layer-opacity-changed";
      readonly layer: RasterLayer;
      readonly previousValue: number;
      readonly value: number;
    }
  | {
      readonly kind: "layer-blend-mode-changed";
      readonly layer: RasterLayer;
      readonly previousValue: LayerBlendMode;
      readonly value: LayerBlendMode;
    };
