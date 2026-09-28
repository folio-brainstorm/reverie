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
