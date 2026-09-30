# @reveriejs/canvas-renderer

Canvas presentation for a Rêverie `World` or `Raster`. Most browser applications should use `@reveriejs/web` instead.

```bash
pnpm add @reveriejs/core @reveriejs/canvas-renderer
```

```ts
import { Camera, World } from "@reveriejs/core";
import { CanvasRenderer } from "@reveriejs/canvas-renderer";

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Expected a canvas element.");
}

const world = new World();
const camera = new Camera();
const renderer = new CanvasRenderer({ canvas, world, camera });
renderer.resize(768, 512, 1);
renderer.render();

// After direct source mutations, invalidate retained render results before rendering.
renderer.markSourceChanged();
renderer.render();

// The independent renderer is owned by this application.
renderer.dispose();
```

See the [repository README](https://github.com/folio-brainstorm/reverie#readme) for the recommended browser facade.


## Renderer-independent View and rotation

`View` owns continuous pan, zoom and clockwise rotation (radians). It has no
World, viewport, DOM or DPR dependency. The transform is
`screen = zoom * R(rotation) * (world - pan)`; pan identifies the world point
at the screen origin. Angles remain unnormalized. View changes do not edit
pixels, document history, World bounds or exported images.

`screenToWorld` and `worldToScreen` share the full transform.
`visibleWorldQuad(viewport)` returns corners in top-left clockwise order;
`visibleWorldBounds(viewport)` returns their axis-aligned bounding rectangle.
`getTransform()` returns `{ a, b, c, d, e, f }` for Canvas, SVG and CSS in
CSS pixels; multiply each coefficient by DPR for a Canvas backing buffer.

`Camera` extends `View` and keeps legacy error codes. Existing `camera`
configuration and properties remain supported, including `visibleWorldRect`
as an alias for visible bounds. CanvasRenderer and CanvasDrawingSession require
exactly one of `view` or `camera`. Their `camera` properties return the same
instance as `view`. ReverieCanvas accepts an optional `view`, shares it with
rendering and input, and defaults to a compatible Camera.

```ts
import { View } from "@reveriejs/core";
import { ReverieCanvas } from "@reveriejs/web";

const view = new View({ zoom: 2, rotation: Math.PI / 6 });
const reverie = new ReverieCanvas({ canvas, width: 640, height: 480, view });
view.panByScreen(12, -4); // Move the image with a pointer in CSS pixels.
view.zoomAt({ x: 320, y: 240 }, 3); // Absolute zoom, stationary anchor.
view.rotateAt({ x: 320, y: 240 }, Math.PI / 4); // Absolute clockwise angle.
reverie.requestViewRender("interactive");
// Once the gesture ends:
reverie.requestViewRender("full");
```

Rendering remains explicit. Multiple independent Views can observe one World.
Canvas rotation uses a reusable world-aligned composition surface covering the
visible bounding box, then projects it once and clips to the transformed World.
This adds temporary canvas memory and composition work while preserving the
zero-angle incremental path and reusable world-space raster results.
