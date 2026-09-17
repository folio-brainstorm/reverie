import { describe, expect, it } from "vitest";

import { Stroke } from "@reverie/core";
import type { Brush, StampCommand } from "@reverie/core";

describe("Stroke stamp direction", () => {
  it.each([
    [{ x: 10, y: 0 }, 0],
    [{ x: 0, y: 10 }, Math.PI / 2],
    [{ x: -10, y: 0 }, Math.PI],
    [{ x: 0, y: -10 }, -Math.PI / 2],
    [{ x: 10, y: 10 }, Math.PI / 4],
  ])("derives actual stamp direction toward %j", (end, expectedDirection) => {
    const stroke = createStroke();

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: end, timestamp: 10 });
    const commands = drainCommands(stroke);

    expect(commands).toHaveLength(2);
    expect(commands[0]?.direction).toBeUndefined();
    expect(commands[1]?.direction).toBeCloseTo(expectedDirection);
  });

  it("omits direction from the first command instead of using rightward zero", () => {
    const stroke = createStroke();

    stroke.addSample({ position: { x: 3, y: 4 }, timestamp: 0 });
    const command = stroke.nextStamp();

    expect(command?.direction).toBeUndefined();
    expect(command === undefined ? true : "direction" in command).toBe(false);
  });

  it("changes direction at a sharp corner without changing stamp placement", () => {
    const stroke = createStroke();

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 10, y: 0 }, timestamp: 10 });
    stroke.addSample({ position: { x: 10, y: 10 }, timestamp: 20 });
    const commands = drainCommands(stroke);

    expect(commands.map((command) => command.position)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(commands[0]?.direction).toBeUndefined();
    expect(commands[1]?.direction).toBeCloseTo(0);
    expect(commands[2]?.direction).toBeCloseTo(Math.PI / 2);
  });

  it("derives direction from placed stamps across resampled input", () => {
    const stroke = new Stroke({
      brush: recordingBrush(5, 1),
      smoothing: 1,
      resampleDistance: 2,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 12, y: 0 }, timestamp: 12 });
    const commands = drainCommands(stroke);

    expect(commands.map((command) => command.position.x)).toEqual([0, 5, 10]);
    expect(commands.map((command) => command.direction)).toEqual([
      undefined,
      0,
      0,
    ]);
  });

  it("keeps direction geometric when adjacent stamp timestamps match", () => {
    const stroke = createStroke();

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 5 });
    stroke.addSample({ position: { x: 0, y: 10 }, timestamp: 5 });
    const commands = drainCommands(stroke);

    expect(commands[1]?.velocity).toBe(0);
    expect(commands[1]?.direction).toBeCloseTo(Math.PI / 2);
  });

  it("handles a zero-length path without inventing direction or stamps", () => {
    const stroke = createStroke();

    stroke.addSample({ position: { x: 5, y: 5 }, timestamp: 0 });
    stroke.addSample({ position: { x: 5, y: 5 }, timestamp: 1 });
    const commands = drainCommands(stroke);

    expect(commands).toHaveLength(1);
    expect(commands[0]?.direction).toBeUndefined();
  });
});

/** Creates a stroke whose ten-unit spacing makes direction assertions exact. */
function createStroke(): Stroke {
  return new Stroke({
    brush: recordingBrush(10, 1),
    smoothing: 1,
    resampleDistance: 10,
  });
}

/** Creates a no-op brush exposing only the metrics required by Stroke. */
function recordingBrush(size: number, spacing: number): Brush {
  return {
    size,
    spacing,
    stamp(_raster, _position): void {},
  };
}

/** Drains every queued stamp without executing the associated brush. */
function drainCommands(stroke: Stroke): StampCommand[] {
  const commands: StampCommand[] = [];

  while (stroke.hasPendingStamps) {
    const command = stroke.nextStamp();

    if (command !== undefined) {
      commands.push(command);
    }
  }

  return commands;
}
