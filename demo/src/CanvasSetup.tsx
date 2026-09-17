import type { FormEvent, ReactElement } from "react";
import { useState } from "react";

import { CANVAS_PRESETS } from "./config/CanvasPresets";
import type { CanvasSetupProps } from "./interfaces/canvas/CanvasSetupProps";
import { validateCanvasSize } from "./ValidateCanvasSize";

/** Lets the user choose and validate document dimensions before drawing starts. */
export function CanvasSetup({ onCreate }: CanvasSetupProps): ReactElement {
  const [width, setWidth] = useState("1024");
  const [height, setHeight] = useState("768");
  const [presetValue, setPresetValue] = useState("1024x768");
  const [error, setError] = useState<string | null>(null);

  const submitCanvas = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const size = { width: Number(width), height: Number(height) };
    const validationError = validateCanvasSize(size);
    setError(validationError);
    if (validationError === null) onCreate(size);
  };

  return (
    <main className="canvas-setup-screen">
      <form className="canvas-setup-form" noValidate onSubmit={submitCanvas}>
        <p className="setup-wordmark">Rêverie</p>
        <h1>New canvas</h1>
        <p className="setup-description">Choose a size and make it yours.</p>
        <label className="setup-field">
          Preset
          <select
            aria-label="Canvas preset"
            value={presetValue}
            onChange={(event) => {
              setPresetValue(event.currentTarget.value);
              const preset = CANVAS_PRESETS.find(
                (candidate) =>
                  `${candidate.width}x${candidate.height}` ===
                  event.currentTarget.value,
              );
              if (preset !== undefined) {
                setWidth(String(preset.width));
                setHeight(String(preset.height));
              }
              setError(null);
            }}
          >
            {CANVAS_PRESETS.map((preset) => (
              <option
                key={preset.name}
                value={`${preset.width}x${preset.height}`}
              >
                {preset.name} · {preset.width} × {preset.height}
              </option>
            ))}
            <option value="custom">Custom size</option>
          </select>
        </label>
        <div className="setup-dimensions">
          <label className="setup-field">
            Width{" "}
            <span className="dimension-input">
              <input
                aria-label="Canvas width"
                aria-describedby="canvas-size-hint canvas-size-error"
                aria-invalid={error !== null}
                type="number"
                inputMode="numeric"
                min="1"
                max="8192"
                step="1"
                required
                value={width}
                onChange={(event) => {
                  setWidth(event.currentTarget.value);
                  setPresetValue("custom");
                  setError(null);
                }}
              />
              <span>px</span>
            </span>
          </label>
          <label className="setup-field">
            Height{" "}
            <span className="dimension-input">
              <input
                aria-label="Canvas height"
                aria-describedby="canvas-size-hint canvas-size-error"
                aria-invalid={error !== null}
                type="number"
                inputMode="numeric"
                min="1"
                max="8192"
                step="1"
                required
                value={height}
                onChange={(event) => {
                  setHeight(event.currentTarget.value);
                  setPresetValue("custom");
                  setError(null);
                }}
              />
              <span>px</span>
            </span>
          </label>
        </div>
        <p className="setup-hint" id="canvas-size-hint">
          1 to 8192 px per side. Maximum area: 4096 × 4096 px.
        </p>
        <p className="setup-error" id="canvas-size-error" role="alert">
          {error}
        </p>
        <button className="create-canvas-button" type="submit">
          Create canvas
        </button>
      </form>
    </main>
  );
}
