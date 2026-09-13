import { Camera, CircleBrush, Raster } from "@reverie/core";
import type { RGBAColor } from "@reverie/core";
import { CanvasRenderer } from "@reverie/renderer";
import { CanvasDrawingSession } from "@reverie/web";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

const DRAWING_WIDTH = 3840;
const DRAWING_HEIGHT = 2160;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const FIT_CAMERA_ZOOM = Math.min(
  VIEWPORT_WIDTH / DRAWING_WIDTH,
  VIEWPORT_HEIGHT / DRAWING_HEIGHT,
);
const INITIAL_PAN_X = 0;
const INITIAL_PAN_Y = 0;
const INITIAL_ZOOM = 8;
const INITIAL_BRUSH_SIZE = 6;
const INITIAL_BRUSH_OPACITY = 0.75;
const INITIAL_BRUSH_SPACING = 0.2;
const INITIAL_BRUSH_COLOR = "#ef6f61";

/** Displays an interactive CircleBrush painting surface with camera controls. */
export function App(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rasterRef = useRef<Raster | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const sessionRef = useRef<CanvasDrawingSession | null>(null);
  const [panX, setPanX] = useState(INITIAL_PAN_X);
  const [panY, setPanY] = useState(INITIAL_PAN_Y);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [brushSize, setBrushSize] = useState(INITIAL_BRUSH_SIZE);
  const [brushOpacity, setBrushOpacity] = useState(INITIAL_BRUSH_OPACITY);
  const [brushSpacing, setBrushSpacing] = useState(INITIAL_BRUSH_SPACING);
  const [brushColor, setBrushColor] = useState(INITIAL_BRUSH_COLOR);
  const [isPainting, setIsPainting] = useState(false);
  const [drawingError, setDrawingError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    const raster = new Raster({ tileSize: 128 });
    const camera = new Camera({
      panX,
      panY,
      zoom: zoom * FIT_CAMERA_ZOOM,
    });
    const renderer = new CanvasRenderer({ canvas, raster, camera });
    const brush = new CircleBrush({
      size: brushSize,
      color: colorFromHex(brushColor),
      opacity: brushOpacity,
      spacing: brushSpacing,
    });
    const session = new CanvasDrawingSession({
      canvas,
      raster,
      camera,
      renderer,
      brush,
      frameBudget: 8,
      onError: (error) => setDrawingError(formatDrawingError(error)),
      onStrokeStart: () => setIsPainting(true),
      onStrokeEnd: () => setIsPainting(false),
    });

    rasterRef.current = raster;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    sessionRef.current = session;
    session.attach();

    return () => {
      session.dispose();
      rasterRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;

    if (camera === null || renderer === null) {
      return;
    }

    camera.setPan(panX, panY);
    camera.setZoom(zoom * FIT_CAMERA_ZOOM);
    renderer.render();
  }, [panX, panY, zoom]);

  useEffect(() => {
    sessionRef.current?.setBrush(
      new CircleBrush({
        size: brushSize,
        color: colorFromHex(brushColor),
        opacity: brushOpacity,
        spacing: brushSpacing,
      }),
    );
  }, [brushColor, brushOpacity, brushSize, brushSpacing]);

  const clearPainting = (): void => {
    const raster = rasterRef.current;
    const renderer = rendererRef.current;

    if (raster === null || renderer === null) {
      return;
    }

    raster.clear();
    renderer.render();
    setDrawingError(null);
  };

  const resetView = (): void => {
    setPanX(INITIAL_PAN_X);
    setPanY(INITIAL_PAN_Y);
    setZoom(INITIAL_ZOOM);
  };

  const updateZoom = (nextZoom: number): void => {
    const maxPanX = DRAWING_WIDTH * (1 - 1 / nextZoom);
    const maxPanY = DRAWING_HEIGHT * (1 - 1 / nextZoom);

    setPanX((currentPanX) => Math.min(currentPanX, maxPanX));
    setPanY((currentPanY) => Math.min(currentPanY, maxPanY));
    setZoom(nextZoom);
  };

  const maxPanX = DRAWING_WIDTH * (1 - 1 / zoom);
  const maxPanY = DRAWING_HEIGHT * (1 - 1 / zoom);

  return (
    <main className="page-shell">
      <section className="demo-card">
        <header className="hero-copy">
          <p className="eyebrow">Rêverie · Circle Brush</p>
          <h1>Paint directly in world space.</h1>
          <p className="intro">
            Press and drag across the canvas to create a continuous Stroke.
            Coalesced pointer samples travel through fixed-distance stamp
            placement, the StampCommand queue, a frame-budgeted
            DrawingScheduler, CircleBrush, Rasterizer, Paint, and Source Over.
          </p>
        </header>

        <div className="brush-controls" aria-label="Brush controls">
          <label className="color-control">
            <span>Color</span>
            <input
              aria-label="Brush color"
              type="color"
              value={brushColor}
              onChange={(event) => setBrushColor(event.currentTarget.value)}
            />
          </label>

          <label>
            <span>
              Size <output>{brushSize.toFixed(1)}</output>
            </span>
            <input
              type="range"
              min="1"
              max="30"
              step="0.5"
              value={brushSize}
              onChange={(event) =>
                setBrushSize(Number(event.currentTarget.value))
              }
            />
          </label>

          <label>
            <span>
              Opacity <output>{Math.round(brushOpacity * 100)}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={brushOpacity}
              onChange={(event) =>
                setBrushOpacity(Number(event.currentTarget.value))
              }
            />
          </label>

          <label>
            <span>
              Spacing <output>{Math.round(brushSpacing * 100)}%</output>
            </span>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={brushSpacing}
              onChange={(event) =>
                setBrushSpacing(Number(event.currentTarget.value))
              }
            />
          </label>

          <button
            type="button"
            className="secondary-button"
            onClick={clearPainting}
          >
            Clear canvas
          </button>
        </div>

        <div className={`canvas-frame${isPainting ? " is-painting" : ""}`}>
          <canvas
            aria-label="Interactive Rêverie painting canvas"
            ref={canvasRef}
          />
          <div className="viewport-status" aria-live="polite">
            {drawingError ?? (isPainting ? "stroke active" : "ready")} · pan (
            {panX.toFixed(1)}, {panY.toFixed(1)}) · zoom {zoom.toFixed(1)}×
          </div>
        </div>

        <div className="view-controls" aria-label="Camera controls">
          <label>
            <span>
              Pan X <output>{panX.toFixed(1)}</output>
            </span>
            <input
              type="range"
              min="0"
              max={maxPanX}
              step="1"
              value={panX}
              disabled={zoom === 1}
              onChange={(event) => setPanX(Number(event.currentTarget.value))}
            />
          </label>

          <label>
            <span>
              Pan Y <output>{panY.toFixed(1)}</output>
            </span>
            <input
              type="range"
              min="0"
              max={maxPanY}
              step="1"
              value={panY}
              disabled={zoom === 1}
              onChange={(event) => setPanY(Number(event.currentTarget.value))}
            />
          </label>

          <label>
            <span>
              Zoom <output>{zoom.toFixed(1)}×</output>
            </span>
            <input
              type="range"
              min="1"
              max="48"
              step="0.5"
              value={zoom}
              onChange={(event) =>
                updateZoom(Number(event.currentTarget.value))
              }
            />
          </label>

          <button type="button" onClick={resetView}>
            Reset view
          </button>
        </div>
      </section>
    </main>
  );
}

/** Converts a browser color-input value into an opaque RGBA8 color. */
function colorFromHex(hexColor: string): RGBAColor {
  const encodedColor = Number.parseInt(hexColor.slice(1), 16);

  return {
    r: (encodedColor >> 16) & 255,
    g: (encodedColor >> 8) & 255,
    b: encodedColor & 255,
    a: 255,
  };
}

/** Converts an unknown scheduler failure into concise Demo status text. */
function formatDrawingError(error: unknown): string {
  return error instanceof Error ? error.message : "Drawing failed.";
}
