# Rêverie

这是一个使用 pnpm workspace 管理的多包项目：

- `core`：可独立构建的 TypeScript 核心包（`@reverie/core`）
- `renderer`：可扩展的渲染后端包（`@reverie/renderer`）
- `demo`：独立的 Vite + React + TypeScript 示例应用
- `test`：独立的 Vitest 测试包，负责测试 `core`

## Raster Pixel API

`Raster` 使用 World Pixel Coordinate 提供稀疏像素读写；调用方无需接触内部的
`TileStore` 或 `Tile`：

```ts
import { Raster } from "@reverie/core";

const raster = new Raster();

raster.setPixel({ x: -1, y: 300 }, { r: 255, g: 0, b: 0, a: 255 });

raster.blendPixel({ x: -1, y: 300 }, { r: 0, g: 0, b: 255, a: 128 });

const color = raster.getPixel({ x: -1, y: 300 });
```

`setPixel` 会直接替换 RGBA8 像素；`blendPixel` 则使用 straight-alpha Source
Over 合成，并会忽略完全透明的源颜色。

## Paint Pipeline

`paintPixel` 将 Rasterizer 的 coverage、画笔颜色 Alpha 和 operation opacity
合成为有效 Alpha，再写入 Raster：

```ts
import { paintPixel, Raster, Rasterizers } from "@reverie/core";

const raster = new Raster();

Rasterizers.rasterizeCircle(
  { center: { x: 100.5, y: 100.5 }, radius: 20 },
  (hit) => {
    paintPixel(raster, hit, {
      color: { r: 255, g: 0, b: 0, a: 255 },
      opacity: 0.5,
    });
  },
);
```

## Circle Brush

`CircleBrush` 封装了圆形 Rasterizer 与 Paint Pipeline。`size` 表示 World
Space 中的直径，`stamp` 接受连续 World Position：

```ts
import { CircleBrush, Raster } from "@reverie/core";

const raster = new Raster();
const brush = new CircleBrush({
  size: 20,
  color: { r: 0, g: 255, b: 0, a: 255 },
  opacity: 0.8,
  spacing: 0.25,
});

brush.stamp(raster, { x: 50.5, y: 50.25 });
```

## Stroke

`Stroke` 保存连续 World Space 中的原始输入采样，并按照 `brush.size ×
brush.spacing` 沿折线路径均匀生成 `StampCommand`。命令由外部 Consumer
决定何时绘制：

```ts
import { Stroke } from "@reverie/core";

const stroke = new Stroke({ brush });

stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
stroke.addSample({ position: { x: 100, y: 50 }, timestamp: 16 });
stroke.end();

while (stroke.hasPendingStamps) {
  const command = stroke.nextStamp();

  if (command === undefined) break;
  stroke.brush.stamp(raster, command.position);
}
```

## Canvas Renderer

`CanvasRenderer` 将稀疏 Raster 按照 Camera 当前视图绘制到 Canvas backing
buffer。修改 Camera 或 Raster 后需要显式调用 `render()`：

```ts
import { Camera, Raster } from "@reverie/core";
import { CanvasRenderer } from "@reverie/renderer";

const raster = new Raster();
const camera = new Camera({ zoom: 8 });
const renderer = new CanvasRenderer({ canvas, raster, camera });

renderer.resize(800, 600);
renderer.render();
```

## Drawing Scheduler

`@reverie/web` 的 `DrawingScheduler` 将 `StampCommand` 包装为可执行的
`DrawingCommand`，并通过可注入的 `FrameDriver` 在软帧预算内按 FIFO 顺序
分批绘制：

```ts
import { DrawingScheduler } from "@reverie/web";

const scheduler = new DrawingScheduler({
  frameBudget: 4,
  onRender: () => renderer.render(),
  onError: (error) => reportDrawingError(error),
});

while (stroke.hasPendingStamps) {
  const stamp = stroke.nextStamp();

  if (stamp === undefined) break;
  scheduler.enqueue({ stamp, brush: stroke.brush, raster });
}
```

`demo` 提供了可直接按下并拖动绘画的连续 Stroke 画布，并可调整颜色、
Brush Size、Spacing、Opacity、Pan 和 Zoom。绘制命令由主线程上的
`DrawingScheduler` 按帧消费。

## 开始使用

```bash
pnpm install
pnpm dev
```

`dev` 和测试命令会保留使用 `// #if DEBUG` 标记的调试代码；生产构建和
带有 `no-debug` 后缀的命令会在编译时移除这些代码。

常用命令：

```bash
pnpm build
pnpm dev
pnpm dev:no-debug
pnpm test
pnpm test:no-debug
pnpm test:watch
pnpm test:verbose
pnpm typecheck
```
