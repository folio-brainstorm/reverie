import type { LayerBlendMode } from "./LayerBlendMode.js";

/** Describes one committed property change on a RasterLayer. */
export type RasterLayerMutation =
  | {
      readonly kind: "name";
      readonly previousValue: string;
      readonly value: string;
    }
  | {
      readonly kind: "visibility";
      readonly previousValue: boolean;
      readonly value: boolean;
    }
  | {
      readonly kind: "opacity";
      readonly previousValue: number;
      readonly value: number;
    }
  | {
      readonly kind: "blend-mode";
      readonly previousValue: LayerBlendMode;
      readonly value: LayerBlendMode;
    };
