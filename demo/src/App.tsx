import { Camera, CircleBrush, Raster, Stroke } from "@reverie/core";
import type { RGBAColor } from "@reverie/core";
import { CanvasRenderer } from "@reverie/renderer";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

const CANVAS_WIDTH = 7680;
const CANVAS_HEIGHT = 4320;
const INITIAL_PAN_X = -45;
const INITIAL_PAN_Y = -30;
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
  const brushRef = useRef<CircleBrush | null>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const isPaintingRef = useRef(false);
  const [panX, setPanX] = useState(INITIAL_PAN_X);
  const [panY, setPanY] = useState(INITIAL_PAN_Y);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [brushSize, setBrushSize] = useState(INITIAL_BRUSH_SIZE);
  const [brushOpacity, setBrushOpacity] = useState(INITIAL_BRUSH_OPACITY);
  const [brushSpacing, setBrushSpacing] = useState(INITIAL_BRUSH_SPACING);
  const [brushColor, setBrushColor] = useState(INITIAL_BRUSH_COLOR);
  const [isPainting, setIsPainting] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    const raster = new Raster({ tileSize: 128 });
    const camera = new Camera({ panX, panY, zoom });
    const renderer = new CanvasRenderer({ canvas, raster, camera });

    renderer.resize(CANVAS_WIDTH, CANVAS_HEIGHT);
    renderer.render();

    rasterRef.current = raster;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    return () => {
      isPaintingRef.current = false;
      activePointerIdRef.current = null;
      rasterRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      strokeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;

    if (camera === null || renderer === null) {
      return;
    }

    camera.setPan(panX, panY);
    camera.setZoom(zoom);
    renderer.render();
  }, [panX, panY, zoom]);

  useEffect(() => {
    brushRef.current = new CircleBrush({
      size: brushSize,
      color: colorFromHex(brushColor),
      opacity: brushOpacity,
      spacing: brushSpacing,
    });
  }, [brushColor, brushOpacity, brushSize, brushSpacing]);

  const addStrokeSamplesAtPointer = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): void => {
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const stroke = strokeRef.current;

    if (camera === null || renderer === null || stroke === null) {
      return;
    }

    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    const pointerEvents = getCoalescedPointerEvents(event.nativeEvent);

    for (const pointerEvent of pointerEvents) {
      const screenPoint = {
        x: ((pointerEvent.clientX - bounds.left) * canvas.width) / bounds.width,
        y:
          ((pointerEvent.clientY - bounds.top) * canvas.height) / bounds.height,
      };

      stroke.addSample({
        position: camera.screenToWorld(screenPoint),
        timestamp: pointerEvent.timeStamp,
      });
    }

    renderer.render();
  };

  const beginPainting = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0 || activePointerIdRef.current !== null) {
      return;
    }

    const raster = rasterRef.current;
    const brush = brushRef.current;

    if (raster === null || brush === null) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    strokeRef.current = new Stroke({ raster, brush });
    isPaintingRef.current = true;
    setIsPainting(true);
    addStrokeSamplesAtPointer(event);
  };

  const continuePainting = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): void => {
    if (
      !isPaintingRef.current ||
      activePointerIdRef.current !== event.pointerId
    ) {
      return;
    }

    event.preventDefault();
    addStrokeSamplesAtPointer(event);
  };

  const finishStroke = (): void => {
    strokeRef.current?.end();
    strokeRef.current = null;
    activePointerIdRef.current = null;
    isPaintingRef.current = false;
    setIsPainting(false);
  };

  const endPainting = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    finishStroke();

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const clearPainting = (): void => {
    rasterRef.current?.clear();
    rendererRef.current?.render();
  };

  const resetView = (): void => {
    setPanX(INITIAL_PAN_X);
    setPanY(INITIAL_PAN_Y);
    setZoom(INITIAL_ZOOM);
  };

  return (
    <main className="page-shell">
      <section className="demo-card">
        <header className="hero-copy">
          <p className="eyebrow">Rêverie · Circle Brush</p>
          <h1>Paint directly in world space.</h1>
          <p className="intro">
            Press and drag across the canvas to create a continuous Stroke.
            Coalesced pointer samples travel through fixed-distance stamp
            placement, CircleBrush, Rasterizer, Paint, and Source Over.
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
            onPointerDown={beginPainting}
            onPointerMove={continuePainting}
            onPointerUp={endPainting}
            onPointerCancel={endPainting}
            onLostPointerCapture={finishStroke}
          />
          <div className="viewport-status" aria-live="polite">
            {isPainting ? "stroke active" : "ready"} · pan ({panX.toFixed(1)},{" "}
            {panY.toFixed(1)}) · zoom {zoom.toFixed(1)}×
          </div>
        </div>

        <div className="view-controls" aria-label="Camera controls">
          <label>
            <span>
              Pan X <output>{panX.toFixed(1)}</output>
            </span>
            <input
              type="range"
              min="-90"
              max="0"
              step="0.5"
              value={panX}
              onChange={(event) => setPanX(Number(event.currentTarget.value))}
            />
          </label>

          <label>
            <span>
              Pan Y <output>{panY.toFixed(1)}</output>
            </span>
            <input
              type="range"
              min="-60"
              max="0"
              step="0.5"
              value={panY}
              onChange={(event) => setPanY(Number(event.currentTarget.value))}
            />
          </label>

          <label>
            <span>
              Zoom <output>{zoom.toFixed(1)}×</output>
            </span>
            <input
              type="range"
              min="2"
              max="24"
              step="0.5"
              value={zoom}
              onChange={(event) => setZoom(Number(event.currentTarget.value))}
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

/**
 * Returns every high-frequency sample represented by a dispatched pointer event.
 * Browsers without coalesced-event support fall back to the dispatched event.
 */
function getCoalescedPointerEvents(
  event: PointerEvent,
): readonly PointerEvent[] {
  const coalescedEvents = event.getCoalescedEvents?.() ?? [];

  return coalescedEvents.length > 0 ? coalescedEvents : [event];
}
