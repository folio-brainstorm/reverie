import type {
  CSSProperties,
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { CircleBrush, ImageBrush } from "@reverie/core";
import type {
  Brush,
  BrushImage,
  RasterLayer,
  RGBAColor,
  ScreenPoint,
} from "@reverie/core";
import type { ExportFormat, ExportRegion } from "@reverie/exporter";
import { ReverieCanvas } from "@reverie/web";
import type { ReverieDownloadOptions } from "@reverie/web";

import { createBrushOutlinePath } from "./CreateBrushOutlinePath";
import { decodeBrushImageFile } from "./DecodeBrushImageFile";
import { exportRasterToConsole } from "./ExportRasterToConsole";
import type { CanvasSize } from "./interfaces/canvas/CanvasSize";
import type { PaintingWorkspaceProps } from "./interfaces/canvas/PaintingWorkspaceProps";
import type { ViewportSize } from "./interfaces/canvas/ViewportSize";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 64;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const INITIAL_BRUSH_SIZE = 16;
const INITIAL_BRUSH_OPACITY = 0.75;
const INITIAL_BRUSH_SPACING = 0.2;
const INITIAL_BRUSH_COLOR = "#ef6f61";
const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
};
const EXPORT_REQUESTS: readonly ReverieDownloadOptions[] = [
  { format: "png", filename: "reverie-export" },
  { format: "jpeg", filename: "reverie-export" },
  { format: "webp", filename: "reverie-export" },
];

/** Presents the responsive full-screen painting workspace and its controls. */
export function PaintingWorkspace({
  canvasSize,
}: PaintingWorkspaceProps): ReactElement {
  const drawingWidth = canvasSize.width;
  const drawingHeight = canvasSize.height;
  const exportRegion: ExportRegion = {
    x: 0,
    y: 0,
    width: drawingWidth,
    height: drawingHeight,
  };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasFrameRef = useRef<HTMLDivElement | null>(null);
  const reverieRef = useRef<ReverieCanvas | null>(null);
  const brushIndicatorRef = useRef<SVGGElement | null>(null);
  const brushOutlineRef = useRef<SVGPathElement | null>(null);
  const panPointerIdRef = useRef<number | null>(null);
  const lastPanPositionRef = useRef<ScreenPoint | null>(null);
  const lastPointerPositionRef = useRef<ScreenPoint | null>(null);
  const imageLoadRequestIdRef = useRef(0);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({
    width: 0,
    height: 0,
  });
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [cameraZoom, setCameraZoom] = useState(1);
  const [brushSize, setBrushSize] = useState(INITIAL_BRUSH_SIZE);
  const [brushOpacity, setBrushOpacity] = useState(INITIAL_BRUSH_OPACITY);
  const [brushSpacing, setBrushSpacing] = useState(INITIAL_BRUSH_SPACING);
  const [brushColor, setBrushColor] = useState(INITIAL_BRUSH_COLOR);
  const [brushImage, setBrushImage] = useState<BrushImage | null>(null);
  const brushSettingsRef = useRef({
    size: INITIAL_BRUSH_SIZE,
    image: brushImage,
  });
  const [imageBrushName, setImageBrushName] = useState<string | null>(null);
  const [isImageBrushLoading, setIsImageBrushLoading] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isCanvasReady, setIsCanvasReady] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );
  const [drawingError, setDrawingError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [isLayersPanelOpen, setIsLayersPanelOpen] = useState(false);
  const [, setLayersRevision] = useState(0);

  const hideBrushIndicator = (): void => {
    brushIndicatorRef.current?.setAttribute("visibility", "hidden");
  };

  /** Pointer updates bypass React; one path contains only the pixel silhouette. */
  const updateBrushIndicator = (position: ScreenPoint): void => {
    lastPointerPositionRef.current = position;
    const indicator = brushIndicatorRef.current;
    const outline = brushOutlineRef.current;
    const camera = reverieRef.current?.camera;

    if (
      indicator === null ||
      outline === null ||
      camera === undefined ||
      panPointerIdRef.current !== null ||
      brushSettingsRef.current.image !== null
    ) {
      hideBrushIndicator();
      return;
    }

    const center = camera.screenToWorld(position);
    if (
      center.x < 0 ||
      center.x >= drawingWidth ||
      center.y < 0 ||
      center.y >= drawingHeight
    ) {
      hideBrushIndicator();
      return;
    }

    outline.setAttribute(
      "d",
      createBrushOutlinePath(center, brushSettingsRef.current.size),
    );
    indicator.setAttribute(
      "transform",
      `matrix(${camera.zoom} 0 0 ${camera.zoom} ${-camera.panX * camera.zoom} ${-camera.panY * camera.zoom})`,
    );
    indicator.setAttribute("visibility", "visible");
  };

  /** Commits the checkerboard and clipping geometry in the canvas render frame. */
  const publishCameraView = (): void => {
    const camera = reverieRef.current?.camera;
    if (camera === undefined) return;
    flushSync(() => {
      setPanX(camera.panX);
      setPanY(camera.panY);
      setCameraZoom(camera.zoom);
    });
  };

  const handleWheel = (event: WheelEvent): void => {
    const reverie = reverieRef.current;
    const canvas = canvasRef.current;
    if (reverie === null || canvas === null) return;

    event.preventDefault();
    const bounds = canvas.getBoundingClientRect();
    const anchor = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const fitZoom = getFitCameraZoom(bounds.width, bounds.height, canvasSize);
    const factor = Math.exp(
      -normalizeWheelDelta(event, bounds.height) * WHEEL_ZOOM_SENSITIVITY,
    );
    const nextZoom = clamp(
      reverie.camera.zoom * factor,
      MIN_ZOOM * fitZoom,
      MAX_ZOOM * fitZoom,
    );
    reverie.camera.zoomAt(anchor, nextZoom);
    reverie.render();
    publishCameraView();
    updateBrushIndicator(anchor);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = canvasFrameRef.current;
    if (canvas === null || frame === null) return;

    let reverie: ReverieCanvas | null = null;
    let readyFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let hasInitializationError = false;

    try {
      reverie = new ReverieCanvas({
        canvas,
        width: drawingWidth,
        height: drawingHeight,
        tileSize: 256,
        brush: createDemoBrush(
          null,
          brushSize,
          brushOpacity,
          brushSpacing,
          brushColor,
        ),
        frameBudget: 8,
        onError: (error) => {
          hasInitializationError = true;
          setDrawingError(formatDrawingError(error));
        },
        onStrokeStart: () => setIsPainting(true),
        onStrokeEnd: () => setIsPainting(false),
      });

      if (hasInitializationError) {
        throw new Error(
          "The drawing runtime could not initialize. Reload to try again.",
        );
      }

      reverieRef.current = reverie;
      const bounds = frame.getBoundingClientRect();
      const fitZoom = getFitCameraZoom(bounds.width, bounds.height, canvasSize);
      const centeredPan = getCenteredPan(
        bounds.width,
        bounds.height,
        fitZoom,
        canvasSize,
      );
      reverie.camera.setZoom(fitZoom);
      reverie.camera.setPan(centeredPan.x, centeredPan.y);
      reverie.render();
      setPanX(centeredPan.x);
      setPanY(centeredPan.y);
      setCameraZoom(fitZoom);

      const updateViewport = (): void => {
        const nextBounds = frame.getBoundingClientRect();
        setViewportSize({ width: nextBounds.width, height: nextBounds.height });
        hideBrushIndicator();
      };
      updateViewport();
      resizeObserver = new ResizeObserver(updateViewport);
      resizeObserver.observe(frame);
      frame.addEventListener("wheel", handleWheel, { passive: false });

      // The initial bitmap and DOM overlays get a paint before the cover fades.
      readyFrame = window.requestAnimationFrame(() => {
        readyFrame = window.requestAnimationFrame(() => setIsCanvasReady(true));
      });
    } catch (error) {
      setInitializationError(formatDrawingError(error));
    }

    return () => {
      window.cancelAnimationFrame(readyFrame);
      imageLoadRequestIdRef.current += 1;
      resizeObserver?.disconnect();
      frame.removeEventListener("wheel", handleWheel);
      reverie?.dispose();
      reverieRef.current = null;
    };
  }, []);

  useEffect(() => {
    brushSettingsRef.current = { size: brushSize, image: brushImage };
    reverieRef.current?.setBrush(
      createDemoBrush(
        brushImage,
        brushSize,
        brushOpacity,
        brushSpacing,
        brushColor,
      ),
    );
    if (lastPointerPositionRef.current !== null)
      updateBrushIndicator(lastPointerPositionRef.current);
  }, [brushColor, brushImage, brushOpacity, brushSize, brushSpacing]);

  const clearPainting = (): void => {
    reverieRef.current?.clear();
    setDrawingError(null);
    setExportStatus(null);
  };

  const refreshLayers = (): void => {
    setLayersRevision((revision) => revision + 1);
    reverieRef.current?.render();
  };

  const handleAddLayer = (): void => {
    const reverie = reverieRef.current;
    if (reverie === null) return;
    try {
      const layer = reverie.world.addLayer();
      try {
        reverie.setActiveLayer(layer);
      } catch (error) {
        reverie.world.removeLayer(layer);
        throw error;
      }
      setDrawingError(null);
      refreshLayers();
    } catch (error) {
      setDrawingError(formatDrawingError(error));
    }
  };

  const handleSelectLayer = (layer: RasterLayer): void => {
    const reverie = reverieRef.current;
    if (reverie === null || reverie.activeLayer === layer) return;
    try {
      reverie.setActiveLayer(layer);
      setDrawingError(null);
      refreshLayers();
    } catch (error) {
      setDrawingError(formatDrawingError(error));
    }
  };

  const handleMoveLayer = (layer: RasterLayer, direction: -1 | 1): void => {
    const reverie = reverieRef.current;
    if (reverie === null) return;
    const index = reverie.world.layers.indexOf(layer);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= reverie.world.layers.length)
      return;
    try {
      reverie.world.moveLayer(layer, nextIndex);
      setDrawingError(null);
      refreshLayers();
    } catch (error) {
      setDrawingError(formatDrawingError(error));
    }
  };

  const handleRemoveLayer = (layer: RasterLayer): void => {
    const reverie = reverieRef.current;
    if (reverie === null || reverie.world.layers.length <= 1) return;
    try {
      reverie.removeLayer(layer);
      setDrawingError(null);
      refreshLayers();
    } catch (error) {
      setDrawingError(formatDrawingError(error));
    }
  };

  const handleLayerOpacityChange = (
    layer: RasterLayer,
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    layer.opacity = Number(event.currentTarget.value);
    refreshLayers();
  };

  const handleLayerNameChange = (
    layer: RasterLayer,
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    layer.name = event.currentTarget.value;
    setLayersRevision((revision) => revision + 1);
  };

  const exportPainting = (): void => {
    const reverie = reverieRef.current;
    if (reverie === null) return;
    try {
      const result = exportRasterToConsole(
        reverie.activeLayer.raster,
        exportRegion,
      );
      setDrawingError(null);
      setExportStatus(
        `Exported ${result.width} × ${result.height} RGBA buffer to console`,
      );
    } catch (error) {
      setExportStatus(null);
      setDrawingError(formatDrawingError(error));
    }
  };

  const exportPaintingAsImage = (request: ReverieDownloadOptions): void => {
    const reverie = reverieRef.current;
    if (reverie === null) return;
    setDrawingError(null);
    setExportStatus(`Encoding ${EXPORT_FORMAT_LABELS[request.format]}...`);
    void reverie
      .download(request)
      .then(() => {
        setExportStatus(`Downloaded ${EXPORT_FORMAT_LABELS[request.format]}`);
      })
      .catch((error: unknown) => {
        setExportStatus(null);
        setDrawingError(formatDrawingError(error));
      });
  };

  const resetView = (): void => {
    const reverie = reverieRef.current;
    const frame = canvasFrameRef.current;
    if (reverie === null || frame === null) return;
    const bounds = frame.getBoundingClientRect();
    const fitZoom = getFitCameraZoom(bounds.width, bounds.height, canvasSize);
    const centeredPan = getCenteredPan(
      bounds.width,
      bounds.height,
      fitZoom,
      canvasSize,
    );
    reverie.camera.setZoom(fitZoom);
    reverie.camera.setPan(centeredPan.x, centeredPan.y);
    reverie.render();
    publishCameraView();
    hideBrushIndicator();
  };

  const handleImageBrushUpload = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file === undefined) return;
    const requestId = ++imageLoadRequestIdRef.current;
    setIsImageBrushLoading(true);
    setDrawingError(null);
    try {
      const decodedImage = await decodeBrushImageFile(file);
      if (requestId !== imageLoadRequestIdRef.current) return;
      setBrushImage(decodedImage);
      setImageBrushName(file.name);
    } catch (error) {
      if (requestId === imageLoadRequestIdRef.current)
        setDrawingError(
          `Image Brush upload failed: ${formatDrawingError(error)}`,
        );
    } finally {
      if (requestId === imageLoadRequestIdRef.current)
        setIsImageBrushLoading(false);
    }
  };

  const useCircleBrush = (): void => {
    imageLoadRequestIdRef.current += 1;
    setBrushImage(null);
    setImageBrushName(null);
    setIsImageBrushLoading(false);
    setDrawingError(null);
  };

  const handlePanStart = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 1 || panPointerIdRef.current !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panPointerIdRef.current = event.pointerId;
    lastPanPositionRef.current = { x: event.clientX, y: event.clientY };
    lastPointerPositionRef.current = null;
    hideBrushIndicator();
    setIsPanning(true);
  };

  const handlePanMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const reverie = reverieRef.current;
    const previousPosition = lastPanPositionRef.current;
    if (event.pointerId !== panPointerIdRef.current) {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (bounds !== undefined)
        updateBrushIndicator({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
      return;
    }
    if (previousPosition === null || reverie === null) return;
    event.preventDefault();
    const { camera } = reverie;
    camera.panBy(
      -(event.clientX - previousPosition.x) / camera.zoom,
      -(event.clientY - previousPosition.y) / camera.zoom,
    );
    lastPanPositionRef.current = { x: event.clientX, y: event.clientY };
    reverie.render();
    publishCameraView();
  };

  const finishPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerId !== panPointerIdRef.current) return;
    panPointerIdRef.current = null;
    lastPanPositionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    hideBrushIndicator();
    setIsPanning(false);
  };

  const drawingLeft = -panX * cameraZoom;
  const drawingTop = -panY * cameraZoom;
  const drawingSurfaceStyle: CSSProperties = {
    left: drawingLeft,
    top: drawingTop,
    width: drawingWidth * cameraZoom,
    height: drawingHeight * cameraZoom,
    backgroundPosition: `0 0, 0 ${cameraZoom}px, ${cameraZoom}px -${cameraZoom}px, -${cameraZoom}px 0`,
    backgroundSize: `${cameraZoom * 2}px ${cameraZoom * 2}px`,
  };
  const visibleLeft = clamp(drawingLeft, 0, viewportSize.width);
  const visibleTop = clamp(drawingTop, 0, viewportSize.height);
  const visibleRight = clamp(
    drawingLeft + drawingWidth * cameraZoom,
    0,
    viewportSize.width,
  );
  const visibleBottom = clamp(
    drawingTop + drawingHeight * cameraZoom,
    0,
    viewportSize.height,
  );
  const canvasStyle: CSSProperties = {
    clipPath: `polygon(${visibleLeft}px ${visibleTop}px, ${visibleRight}px ${visibleTop}px, ${visibleRight}px ${visibleBottom}px, ${visibleLeft}px ${visibleBottom}px)`,
  };
  const zoomPercentage = Math.round(
    (cameraZoom /
      getFitCameraZoom(viewportSize.width, viewportSize.height, canvasSize)) *
      100,
  );

  return (
    <main className="workspace-shell" aria-busy={!isCanvasReady}>
      <div
        className={`canvas-frame${isPanning ? " is-panning" : ""}`}
        ref={canvasFrameRef}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onLostPointerCapture={finishPan}
        onPointerCancel={finishPan}
        onPointerDown={handlePanStart}
        onPointerMove={handlePanMove}
        onPointerUp={finishPan}
        onPointerLeave={() => {
          if (panPointerIdRef.current === null) {
            lastPointerPositionRef.current = null;
            hideBrushIndicator();
          }
        }}
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
        <svg
          aria-hidden="true"
          className="brush-indicator"
          style={canvasStyle}
          width="100%"
          height="100%"
        >
          <defs>
            <path
              ref={brushOutlineRef}
              id="brush-outline"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          </defs>
          <g ref={brushIndicatorRef} visibility="hidden">
            <use
              href="#brush-outline"
              className="brush-outline-shadow"
              fill="none"
            />
            <use
              href="#brush-outline"
              className="brush-outline-highlight"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>
      </div>

      <header className="workspace-toolbar">
        <label className="toolbar-color-control" title="Brush color">
          <input
            aria-label="Brush color"
            type="color"
            value={brushColor}
            onChange={(event) => setBrushColor(event.currentTarget.value)}
          />
          <span>{brushColor.toUpperCase()}</span>
        </label>
        <p className="workspace-wordmark">Rêverie</p>
        <details className="tool-menu">
          <summary>Tools</summary>
          <div className="tool-menu-panel">
            <p className="tool-group-label">Brush tip</p>
            <label className="image-upload-button">
              <input
                accept="image/*"
                aria-label="Upload an Image Brush"
                className="visually-hidden"
                type="file"
                onChange={(event) => void handleImageBrushUpload(event)}
              />
              {isImageBrushLoading ? "Decoding..." : "Upload image"}
            </label>
            {brushImage !== null && (
              <button type="button" onClick={useCircleBrush}>
                Use circle
              </button>
            )}
            <p className="brush-tip-status" title={imageBrushName ?? undefined}>
              {imageBrushName ?? "Circle brush"}
            </p>
            <label className="spacing-control">
              Spacing <output>{Math.round(brushSpacing * 100)}%</output>
              <input
                aria-label="Brush spacing"
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
            <p className="tool-group-label">Canvas</p>
            <button type="button" onClick={resetView}>
              Reset view
            </button>
            <button type="button" onClick={clearPainting}>
              Clear canvas
            </button>
            <p className="tool-group-label">Export</p>
            <div className="export-actions">
              {EXPORT_REQUESTS.map((request) => (
                <button
                  key={request.format}
                  type="button"
                  onClick={() => exportPaintingAsImage(request)}
                >
                  {EXPORT_FORMAT_LABELS[request.format]}
                </button>
              ))}
            </div>
            <button type="button" onClick={exportPainting}>
              Export to console
            </button>
            <p className="tool-hint">
              Middle-drag to pan. Scroll to zoom at the cursor.
            </p>
          </div>
        </details>
        <button
          className={`layers-toggle${isLayersPanelOpen ? " is-active" : ""}`}
          type="button"
          aria-label="Toggle layers panel"
          aria-pressed={isLayersPanelOpen}
          onClick={() => setIsLayersPanelOpen((isOpen) => !isOpen)}
        >
          Layers
        </button>
        <div className="canvas-metrics" aria-label="Canvas data">
          <span>
            <small>Canvas</small>
            {drawingWidth} × {drawingHeight}
          </span>
          <span className="pan-metric">
            <small>Pan</small>
            {panX.toFixed(1)}, {panY.toFixed(1)}
          </span>
          <span>
            <small>Zoom</small>
            {zoomPercentage}%
          </span>
        </div>
      </header>

      <aside className="brush-dock" aria-label="Brush controls">
        <label className="vertical-slider-control">
          <span>Size</span>
          <output>{brushSize}</output>
          <input
            aria-label="Brush size"
            type="range"
            min="1"
            max="32"
            step="1"
            value={brushSize}
            onChange={(event) =>
              setBrushSize(Number(event.currentTarget.value))
            }
          />
        </label>
        <div className="dock-divider" />
        <label className="vertical-slider-control">
          <span>Opacity</span>
          <output>{Math.round(brushOpacity * 100)}%</output>
          <input
            aria-label="Brush opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={brushOpacity}
            onChange={(event) =>
              setBrushOpacity(Number(event.currentTarget.value))
            }
          />
        </label>
      </aside>

      {isLayersPanelOpen && (
        <aside className="layers-panel" aria-label="Layers">
          <div className="layers-panel-header">
            <div>
              <p className="layers-eyebrow">Composition</p>
              <h2>Layers</h2>
            </div>
            <button
              className="layers-add-button"
              type="button"
              onClick={handleAddLayer}
            >
              + Add
            </button>
          </div>
          <div className="layers-list">
            {[
              ...((reverieRef.current?.world.layers ??
                []) as readonly RasterLayer[]),
            ]
              .reverse()
              .map((layer) => {
                const index =
                  reverieRef.current?.world.layers.indexOf(layer) ?? -1;
                const isActive = reverieRef.current?.activeLayer === layer;
                const isTop =
                  index === (reverieRef.current?.world.layers.length ?? 0) - 1;
                const isBottom = index === 0;
                return (
                  <div
                    className={`layer-item${isActive ? " is-active" : ""}`}
                    key={index}
                  >
                    <button
                      className="layer-select-button"
                      type="button"
                      aria-label={`Select ${layer.name}`}
                      onClick={() => handleSelectLayer(layer)}
                    >
                      <span className="layer-visibility-mark">
                        {layer.visible ? "●" : "○"}
                      </span>
                      <span className="layer-name">{layer.name}</span>
                    </button>
                    <input
                      className="layer-name-input"
                      aria-label={`Rename ${layer.name}`}
                      value={layer.name}
                      onChange={(event) => handleLayerNameChange(layer, event)}
                    />
                    <label className="layer-opacity-control">
                      <span>Opacity</span>
                      <output>{Math.round(layer.opacity * 100)}%</output>
                      <input
                        aria-label={`${layer.name} opacity`}
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={layer.opacity}
                        onChange={(event) =>
                          handleLayerOpacityChange(layer, event)
                        }
                      />
                    </label>
                    <div className="layer-actions">
                      <button
                        type="button"
                        aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                        aria-pressed={layer.visible}
                        onClick={() => {
                          layer.visible = !layer.visible;
                          refreshLayers();
                        }}
                      >
                        {layer.visible ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${layer.name} up`}
                        disabled={isTop}
                        onClick={() => handleMoveLayer(layer, 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${layer.name} down`}
                        disabled={isBottom}
                        onClick={() => handleMoveLayer(layer, -1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${layer.name}`}
                        disabled={
                          (reverieRef.current?.world.layers.length ?? 0) <= 1
                        }
                        onClick={() => handleRemoveLayer(layer)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </aside>
      )}

      <div
        className={`workspace-status${drawingError !== null ? " has-error" : ""}`}
        role={drawingError !== null ? "alert" : "status"}
      >
        {drawingError ??
          exportStatus ??
          (isPanning
            ? "Panning"
            : isPainting
              ? "Painting"
              : brushImage === null
                ? "Circle brush"
                : "Image brush")}
      </div>
      <div
        className={`loading-screen${isCanvasReady ? " is-hidden" : ""}`}
        aria-hidden={isCanvasReady}
      >
        <p className="loading-wordmark">Rêverie</p>
        {initializationError !== null && (
          <div className="loading-error" role="alert">
            <p>{initializationError}</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

/** Creates the selected demo brush, enabling path following for image tips. */
function createDemoBrush(
  image: BrushImage | null,
  size: number,
  opacity: number,
  spacing: number,
  hexColor: string,
): Brush {
  const color = colorFromHex(hexColor);
  return image === null
    ? new CircleBrush({ size, color, opacity, spacing })
    : new ImageBrush({
        image,
        size,
        color,
        opacity,
        spacing,
        dynamics: { rotation: { direction: {} } },
      });
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

/** Fits the document inside the viewport, with room for the floating controls. */
function getFitCameraZoom(
  width: number,
  height: number,
  drawingSize: CanvasSize,
): number {
  if (width <= 0 || height <= 0) return 1;
  return Math.min(
    Math.max(1, width - 64) / drawingSize.width,
    Math.max(1, height - 128) / drawingSize.height,
  );
}

/** Computes the world origin needed to center the drawing at the given scale. */
function getCenteredPan(
  width: number,
  height: number,
  zoom: number,
  drawingSize: CanvasSize,
): ScreenPoint {
  return {
    x: (drawingSize.width - width / zoom) / 2,
    y: (drawingSize.height - height / zoom) / 2,
  };
}

/** Converts an unknown drawing failure into concise status text. */
function formatDrawingError(error: unknown): string {
  return error instanceof Error ? error.message : "Drawing failed.";
}

/** Normalizes line and page wheel units to CSS pixels. */
function normalizeWheelDelta(
  event: WheelEvent,
  viewportHeight: number,
): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE)
    return event.deltaY * viewportHeight;
  return event.deltaY;
}

/** Restricts a coordinate or zoom value to an inclusive interval. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
