import { CircleBrush, Rasterizers } from "@reverie/core";
import type { PixelCoord, RGBAColor, ScreenPoint } from "@reverie/core";
import { ReverieCanvas } from "@reverie/web";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";
import { useEffect, useRef, useState } from "react";

const DRAWING_WIDTH = 16;
const DRAWING_HEIGHT = 16;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const FIT_CAMERA_ZOOM = Math.min(
  VIEWPORT_WIDTH / DRAWING_WIDTH,
  VIEWPORT_HEIGHT / DRAWING_HEIGHT,
);
const INITIAL_ZOOM = 1;
const INITIAL_CAMERA_ZOOM = INITIAL_ZOOM * FIT_CAMERA_ZOOM;
const INITIAL_PAN_X =
  (DRAWING_WIDTH - VIEWPORT_WIDTH / INITIAL_CAMERA_ZOOM) / 2;
const INITIAL_PAN_Y =
  (DRAWING_HEIGHT - VIEWPORT_HEIGHT / INITIAL_CAMERA_ZOOM) / 2;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 64;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const INITIAL_BRUSH_SIZE = 1;
const INITIAL_BRUSH_OPACITY = 0.75;
const INITIAL_BRUSH_SPACING = 0.2;
const INITIAL_BRUSH_COLOR = "#ef6f61";

/** Displays an interactive CircleBrush painting surface with camera controls. */
export function App(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasFrameRef = useRef<HTMLDivElement | null>(null);
  const reverieRef = useRef<ReverieCanvas | null>(null);
  const panPointerIdRef = useRef<number | null>(null);
  const lastPanPositionRef = useRef<ScreenPoint | null>(null);
  const [panX, setPanX] = useState(INITIAL_PAN_X);
  const [panY, setPanY] = useState(INITIAL_PAN_Y);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [pointerScreenPosition, setPointerScreenPosition] =
    useState<ScreenPoint | null>(null);
  const [brushSize, setBrushSize] = useState(INITIAL_BRUSH_SIZE);
  const [brushOpacity, setBrushOpacity] = useState(INITIAL_BRUSH_OPACITY);
  const [brushSpacing, setBrushSpacing] = useState(INITIAL_BRUSH_SPACING);
  const [brushColor, setBrushColor] = useState(INITIAL_BRUSH_COLOR);
  const [isPainting, setIsPainting] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [drawingError, setDrawingError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const canvasFrame = canvasFrameRef.current;

    if (canvas === null || canvasFrame === null) {
      return;
    }

    const reverie = new ReverieCanvas({
      canvas,
      width: DRAWING_WIDTH,
      height: DRAWING_HEIGHT,
      tileSize: DRAWING_WIDTH,
      brush: new CircleBrush({
        size: brushSize,
        color: colorFromHex(brushColor),
        opacity: brushOpacity,
        spacing: brushSpacing,
      }),
      frameBudget: 8,
      onError: (error) => setDrawingError(formatDrawingError(error)),
      onStrokeStart: () => setIsPainting(true),
      onStrokeEnd: () => setIsPainting(false),
    });

    reverie.camera.setPan(panX, panY);
    reverie.camera.setZoom(zoom * FIT_CAMERA_ZOOM);
    reverie.render();
    reverieRef.current = reverie;
    canvasFrame.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvasFrame.removeEventListener("wheel", handleWheel);
      reverie.dispose();
      reverieRef.current = null;
    };
  }, []);

  useEffect(() => {
    const reverie = reverieRef.current;

    if (reverie === null) {
      return;
    }

    reverie.camera.setPan(panX, panY);
    reverie.camera.setZoom(zoom * FIT_CAMERA_ZOOM);
    reverie.render();
  }, [panX, panY, zoom]);

  useEffect(() => {
    reverieRef.current?.setBrush(
      new CircleBrush({
        size: brushSize,
        color: colorFromHex(brushColor),
        opacity: brushOpacity,
        spacing: brushSpacing,
      }),
    );
  }, [brushColor, brushOpacity, brushSize, brushSpacing]);

  const clearPainting = (): void => {
    reverieRef.current?.clear();
    setDrawingError(null);
  };

  const resetView = (): void => {
    setPanX(INITIAL_PAN_X);
    setPanY(INITIAL_PAN_Y);
    setZoom(INITIAL_ZOOM);
  };

  const handlePanStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 1 || panPointerIdRef.current !== null) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panPointerIdRef.current = event.pointerId;
    lastPanPositionRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    setPointerScreenPosition(null);
    setIsPanning(true);
  };

  const handlePanMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const reverie = reverieRef.current;
    const previousPosition = lastPanPositionRef.current;

    if (event.pointerId !== panPointerIdRef.current) {
      const canvas = canvasRef.current;

      if (canvas === null) {
        return;
      }

      const bounds = canvas.getBoundingClientRect();
      setPointerScreenPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      return;
    }

    if (previousPosition === null || reverie === null) {
      return;
    }

    event.preventDefault();
    const { camera } = reverie;
    camera.panBy(
      -(event.clientX - previousPosition.x) / camera.zoom,
      -(event.clientY - previousPosition.y) / camera.zoom,
    );
    lastPanPositionRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
    reverie.render();
    setPanX(camera.panX);
    setPanY(camera.panY);
  };

  const handlePanEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerId !== panPointerIdRef.current) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    panPointerIdRef.current = null;
    lastPanPositionRef.current = null;
    setIsPanning(false);
  };

  const handlePanCaptureLoss = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.pointerId !== panPointerIdRef.current) {
      return;
    }

    panPointerIdRef.current = null;
    lastPanPositionRef.current = null;
    setIsPanning(false);
  };

  const handleWheel = (event: WheelEvent): void => {
    const reverie = reverieRef.current;
    const canvasFrame = canvasFrameRef.current;
    const canvas = canvasRef.current;

    if (reverie === null || canvasFrame === null || canvas === null) {
      return;
    }

    event.preventDefault();
    const { camera } = reverie;
    const bounds = canvas.getBoundingClientRect();
    const anchor = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const zoomFactor = Math.exp(
      -normalizeWheelDelta(event) * WHEEL_ZOOM_SENSITIVITY,
    );
    const nextZoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, (camera.zoom / FIT_CAMERA_ZOOM) * zoomFactor),
    );

    camera.zoomAt(anchor, nextZoom * FIT_CAMERA_ZOOM);
    reverie.render();
    setPointerScreenPosition(anchor);
    setPanX(camera.panX);
    setPanY(camera.panY);
    setZoom(nextZoom);
  };

  const cameraZoom = zoom * FIT_CAMERA_ZOOM;
  const drawingLeft = -panX * cameraZoom;
  const drawingTop = -panY * cameraZoom;
  const drawingScreenWidth = DRAWING_WIDTH * cameraZoom;
  const drawingScreenHeight = DRAWING_HEIGHT * cameraZoom;
  const drawingRight = drawingLeft + drawingScreenWidth;
  const drawingBottom = drawingTop + drawingScreenHeight;
  const visibleLeft = clamp(drawingLeft, 0, VIEWPORT_WIDTH);
  const visibleTop = clamp(drawingTop, 0, VIEWPORT_HEIGHT);
  const visibleRight = clamp(drawingRight, 0, VIEWPORT_WIDTH);
  const visibleBottom = clamp(drawingBottom, 0, VIEWPORT_HEIGHT);
  const drawingSurfaceStyle: CSSProperties = {
    left: drawingLeft,
    top: drawingTop,
    width: drawingScreenWidth,
    height: drawingScreenHeight,
    backgroundPosition: `0 0, 0 ${cameraZoom}px, ${cameraZoom}px -${cameraZoom}px, -${cameraZoom}px 0`,
    backgroundSize: `${cameraZoom * 2}px ${cameraZoom * 2}px`,
  };
  const canvasStyle: CSSProperties = {
    clipPath: `polygon(${visibleLeft}px ${visibleTop}px, ${visibleRight}px ${visibleTop}px, ${visibleRight}px ${visibleBottom}px, ${visibleLeft}px ${visibleBottom}px)`,
  };
  const indicatorPixels: PixelCoord[] = [];

  if (pointerScreenPosition !== null && !isPanning) {
    const pointerWorldPosition = {
      x: panX + pointerScreenPosition.x / cameraZoom,
      y: panY + pointerScreenPosition.y / cameraZoom,
    };
    const isInsideDrawing =
      pointerWorldPosition.x >= 0 &&
      pointerWorldPosition.x < DRAWING_WIDTH &&
      pointerWorldPosition.y >= 0 &&
      pointerWorldPosition.y < DRAWING_HEIGHT;

    if (isInsideDrawing) {
      Rasterizers.rasterizeCircle(
        {
          center: pointerWorldPosition,
          radius: brushSize / 2,
        },
        ({ pixel }) => indicatorPixels.push(pixel),
      );
    }
  }

  return (
    <main className="page-shell">
      <section className="demo-card">
        <header className="hero-copy">
          <p className="eyebrow">Rêverie · Circle Brush</p>
          <h1>Paint directly in world space.</h1>
          <p className="intro">
            Paint inside the 16 × 16 pixel canvas with the left mouse button.
            Drag with the middle button to pan, and scroll over any point to
            zoom around that exact position.
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
              min="0.5"
              max="16"
              step="0.25"
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

        <div
          className={`canvas-frame${isPainting ? " is-painting" : ""}${isPanning ? " is-panning" : ""}`}
          ref={canvasFrameRef}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
            }
          }}
          onLostPointerCapture={handlePanCaptureLoss}
          onPointerCancel={handlePanEnd}
          onPointerDown={handlePanStart}
          onPointerLeave={() => {
            if (panPointerIdRef.current === null) {
              setPointerScreenPosition(null);
            }
          }}
          onPointerMove={handlePanMove}
          onPointerUp={handlePanEnd}
        >
          <div
            aria-hidden="true"
            className="drawing-surface"
            style={drawingSurfaceStyle}
          />
          <canvas
            aria-label="Interactive Rêverie painting canvas"
            ref={canvasRef}
            style={canvasStyle}
          />
          <div
            aria-hidden="true"
            className="brush-indicator"
            style={canvasStyle}
          >
            {indicatorPixels.map((pixel) => (
              <span
                className="brush-indicator-pixel"
                key={`${pixel.x}:${pixel.y}`}
                style={{
                  left: (pixel.x - panX) * cameraZoom,
                  top: (pixel.y - panY) * cameraZoom,
                  width: cameraZoom,
                  height: cameraZoom,
                }}
              />
            ))}
          </div>
          <div className="viewport-status" aria-live="polite">
            {drawingError ??
              (isPanning ? "panning" : isPainting ? "stroke active" : "ready")}
            {" · "}16 × 16 px · pan ({panX.toFixed(2)}, {panY.toFixed(2)}) ·
            zoom {zoom.toFixed(2)}×
          </div>
        </div>

        <div className="view-toolbar" aria-label="Camera controls">
          <p>Middle-drag to pan · Wheel to zoom at cursor</p>
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

/** Converts browser wheel units into an approximate pixel displacement. */
function normalizeWheelDelta(event: WheelEvent): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }

  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * VIEWPORT_HEIGHT;
  }

  return event.deltaY;
}

/** Restricts a number to an inclusive finite interval. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
