# @reverie/web

Browser input and canvas runtime for Rêverie. Use this package for a standard interactive canvas.

```bash
pnpm add @reverie/core @reverie/web
```

```ts
import { PixelBrush } from "@reverie/core";
import { ReverieCanvas } from "@reverie/web";

const canvas = document.querySelector("canvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Expected a canvas element.");
}

const reverie = new ReverieCanvas({
  canvas,
  width: 1024,
  height: 768,
  brush: new PixelBrush({ size: 1, color: { r: 0, g: 0, b: 0, a: 255 } }),
});

// Pointer input and responsive canvas sizing are attached automatically.
reverie.camera.panBy(20, 0);
reverie.requestViewRender("full");

// When the owning view unmounts:
reverie.dispose();
```

`ReverieCanvas` owns its `session` and `renderer`. Do not dispose those objects independently. The facade manages source invalidation for drawing through its session.

See the [repository README](https://github.com/folio-brainstorm/reverie#readme) for the package map and development instructions.
