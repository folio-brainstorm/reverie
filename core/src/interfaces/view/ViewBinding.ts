import type { View } from "../../core/view/View.js";
import type { Camera } from "../../core/camera/Camera.js";

/** Exactly one projection, with a legacy Camera configuration alternative. */
export type ViewBinding =
  | { readonly view: View; readonly camera?: never }
  | { readonly camera: Camera; readonly view?: never };
