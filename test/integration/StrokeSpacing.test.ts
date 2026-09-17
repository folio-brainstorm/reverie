import { describe, expect, it } from "vitest";

import {
  CircleBrush,
  ErrorCodes,
  Raster,
  ReverieRangeError,
  Stroke,
} from "@reverie/core";
import type { Brush, StampCommand, WorldPoint } from "@reverie/core";

const COLOR = { r: 84, g: 153, b: 255, a: 255 };

describe("Stroke dynamic stamp spacing", () => {
  it("uses the brush size ratio to fill a long processed segment", () => {
    const stroke = new Stroke({
      brush: new CircleBrush({ size: 50, spacing: 0.2, color: COLOR }),
      resampleDistance: 500,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 500, y: 0 }, timestamp: 500 });

    expect(drainPositions(stroke)).toEqual(
      Array.from({ length: 51 }, (_value, index) => ({
        x: index * 10,
        y: 0,
      })),
    );
  });

  it("accepts spacing ratios greater than one", () => {
    const stroke = new Stroke({
      brush: new CircleBrush({ size: 10, spacing: 2, color: COLOR }),
      resampleDistance: 40,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 40, y: 0 }, timestamp: 40 });

    expect(drainPositions(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
    ]);
  });

  it("keeps distribution identical for equivalent sparse and dense input", () => {
    const createStroke = (): Stroke =>
      new Stroke({
        brush: new CircleBrush({ size: 50, spacing: 0.2, color: COLOR }),
        smoothing: 1,
        resampleDistance: 500,
      });
    const sparse = createStroke();
    const dense = createStroke();

    sparse.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    sparse.addSample({ position: { x: 500, y: 0 }, timestamp: 500 });
    for (let x = 0; x <= 500; x += 50) {
      dense.addSample({ position: { x, y: 0 }, timestamp: x });
    }

    expect(drainCommands(dense)).toEqual(drainCommands(sparse));
  });

  it("carries a dynamic interval remainder across processed segments", () => {
    const stroke = new Stroke({
      brush: new CircleBrush({ size: 50, spacing: 0.2, color: COLOR }),
      smoothing: 1,
      resampleDistance: 6,
    });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 6, y: 0 }, timestamp: 6 });
    stroke.addSample({ position: { x: 26, y: 0 }, timestamp: 26 });

    expect(drainPositions(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  it("uses each resolved size for that stamp's outgoing interval", () => {
    const createStroke = (): Stroke =>
      new Stroke({
        brush: new CircleBrush({
          size: 50,
          spacing: 0.2,
          color: COLOR,
          dynamics: { size: { pressure: { min: 0 } } },
        }),
        resampleDistance: 100,
      });
    const small = createStroke();
    const large = createStroke();

    for (const stroke of [small, large]) {
      const pressure = stroke === small ? 0.25 : 1;
      stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0, pressure });
      stroke.addSample({ position: { x: 100, y: 0 }, timestamp: 100, pressure });
    }

    expect(drainPositions(small).slice(0, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 2.5, y: 0 },
      { x: 5, y: 0 },
      { x: 7.5, y: 0 },
    ]);
    expect(drainPositions(large).slice(0, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it("uses size jitter before resolving the outgoing interval", () => {
    const brush = new CircleBrush({
      size: 50,
      spacing: 0.2,
      color: COLOR,
      seed: 42,
      jitter: { size: 0.2 },
    });
    const stroke = new Stroke({ brush, strokeSeed: 7, resampleDistance: 100 });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    stroke.addSample({ position: { x: 100, y: 0 }, timestamp: 100 });

    const commands = drainCommands(stroke);
    expect(commands[1]?.position.x).toBeCloseTo(
      brush.resolveStampDistance(commands[0]!),
    );
  });

  it("keeps spacing jitter deterministic and isolated from other variation", () => {
    const createStroke = (jitter: object): Stroke =>
      new Stroke({
        brush: new CircleBrush({
          size: 50,
          spacing: 0.2,
          color: COLOR,
          seed: 99,
          jitter,
        }),
        strokeSeed: 123,
        resampleDistance: 100,
      });
    const spacingOnly = createStroke({ spacing: 0.2 });
    const allVariation = createStroke({
      spacing: 0.2,
      rotation: 1,
      opacity: 0.5,
      scatter: { along: 3, across: 2 },
    });

    for (const stroke of [spacingOnly, allVariation]) {
      stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
      stroke.addSample({ position: { x: 100, y: 0 }, timestamp: 100 });
    }

    const spacingCommands = drainCommands(spacingOnly);
    const variedCommands = drainCommands(allVariation);
    expect(variedCommands.map((command) => command.position)).toEqual(
      spacingCommands.map((command) => command.position),
    );

    for (let index = 1; index < spacingCommands.length; index += 1) {
      const interval =
        spacingCommands[index]!.position.x -
        spacingCommands[index - 1]!.position.x;
      expect(interval).toBeGreaterThanOrEqual(8);
      expect(interval).toBeLessThanOrEqual(12);
    }
  });

  it("uses the base interval when resolved size is zero", () => {
    const brush = new CircleBrush({
      size: 50,
      spacing: 0.2,
      color: COLOR,
      dynamics: { size: { pressure: { min: 0 } } },
      jitter: { spacing: 2 },
    });
    const stroke = new Stroke({ brush, resampleDistance: 10 });

    stroke.addSample({ position: { x: 0, y: 0 }, timestamp: 0, pressure: 0 });
    stroke.addSample({ position: { x: 30, y: 0 }, timestamp: 30, pressure: 0 });

    expect(drainPositions(stroke)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
    const raster = new Raster();
    brush.stamp(raster, { x: 0, y: 0 }, {
      position: { x: 0, y: 0 },
      pressure: 0,
    });
    expect(raster.getPixel({ x: 0, y: 0 }).a).toBe(0);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid spacing jitter %s",
    (spacing) => {
      expect(
        () =>
          new CircleBrush({
            size: 50,
            spacing: 0.2,
            color: COLOR,
            jitter: { spacing },
          }),
      ).toThrow(`[${ErrorCodes.BRUSH.INVALID_JITTER_AMPLITUDE}]`);
    },
  );

  it("clamps a non-positive spacing jitter result to a positive interval", () => {
    const brush = new CircleBrush({
      size: 50,
      spacing: 0.2,
      color: COLOR,
      jitter: { spacing: 2 },
    });

    expect(
      brush.resolveStampDistance({
        position: { x: 0, y: 0 },
        strokeSeed: 0,
        stampIndex: 3,
      }),
    ).toBeGreaterThan(0);
  });

  it("rejects an invalid custom brush interval before placement can loop", () => {
    const addSample = (): void => {
      const brush: Brush = {
        size: 50,
        spacing: 0.2,
        resolveStampDistance(): number {
          return 0;
        },
        stamp(): void {},
      };
      new Stroke({ brush }).addSample({ position: { x: 0, y: 0 }, timestamp: 0 });
    };

    expect(addSample).toThrow(ReverieRangeError);
    expect(addSample).toThrow(
      `[${ErrorCodes.STROKE.INVALID_RESOLVED_STAMP_DISTANCE}]`,
    );
  });
});

/** Removes all currently queued commands and returns their positions in order. */
function drainPositions(stroke: Stroke): WorldPoint[] {
  return drainCommands(stroke).map((command) => command.position);
}

/** Removes all currently queued commands in FIFO order. */
function drainCommands(stroke: Stroke): StampCommand[] {
  const commands: StampCommand[] = [];
  for (
    let command = stroke.nextStamp();
    command !== undefined;
    command = stroke.nextStamp()
  ) {
    commands.push(command);
  }
  return commands;
}
