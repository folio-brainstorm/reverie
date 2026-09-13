import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  DiagnosticCodes,
  ErrorCodes,
} from "@reverie/core";
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticReporter,
  DiagnosticSeverity,
  WorldConfig,
} from "@reverie/core";
import {
  DEFAULT_WORLD_TILE_SIZE,
  defaultWorldConfig,
} from "../../core/src/config/DefaultWorldConfig";
import { World } from "../../core/src/core/world/World";
import { ReverieRangeError } from "../../core/src/utils/errors/ReverieErrors";
import { DiagnosticDefinitions } from "../../core/src/utils/diagnostic/DiagnosticDefinitions";
import {
  consoleDiagnosticReporter,
  createDiagnostic,
  reportDiagnostic,
} from "../../core/src/utils/diagnostic/Diagnostics";

const originalDefaultTileSize = defaultWorldConfig.tileSize;
const originalDefaultReporter = defaultWorldConfig.reporter;

afterEach(() => {
  defaultWorldConfig.tileSize = originalDefaultTileSize;
  defaultWorldConfig.reporter = originalDefaultReporter;
  vi.restoreAllMocks();
});

describe("diagnostic definitions", () => {
  it("derives unique, well-formed diagnostic codes", () => {
    const codes = Object.values(DiagnosticCodes)
      .flatMap((group) => Object.values(group));

    expect(new Set(codes).size).toBe(codes.length);

    for (const code of codes) {
      expect(code).toMatch(/^DC_[A-Z][A-Z0-9_]*_\d{4}$/);
      expect(code).not.toMatch(/_0000$/);
    }

    expect(DiagnosticCodes.WORLD.INVALID_DEFAULT_TILE_SIZE)
      .toBe(DiagnosticDefinitions.WORLD.INVALID_DEFAULT_TILE_SIZE.code);
  });

  it("creates and reports an immutable formatted diagnostic", () => {
    const reporter = vi.fn<DiagnosticReporter>();

    reportDiagnostic(
      reporter,
      DiagnosticDefinitions.WORLD.INVALID_DEFAULT_TILE_SIZE,
      { tileSize: 0, fallbackTileSize: DEFAULT_WORLD_TILE_SIZE },
    );

    expect(reporter).toHaveBeenCalledOnce();
    const diagnostic = reporter.mock.calls[0]![0];

    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(diagnostic).toEqual({
      severity: "warning",
      code: DiagnosticCodes.WORLD.INVALID_DEFAULT_TILE_SIZE,
      message: "Default world tile size `0` is invalid. Falling back to `256`.",
    });
  });

  it("routes warning and info diagnostics to the matching console methods", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const code = DiagnosticCodes.WORLD.INVALID_DEFAULT_TILE_SIZE;

    consoleDiagnosticReporter({ severity: "warning", code, message: "warning" });
    consoleDiagnosticReporter({ severity: "info", code, message: "info" });

    expect(warn).toHaveBeenCalledWith("[DC_WORLD_0001] warning");
    expect(info).toHaveBeenCalledWith("[DC_WORLD_0001] info");
  });

  if (false) {
    const severity: DiagnosticSeverity = "warning";
    const code: DiagnosticCode = DiagnosticCodes.WORLD.INVALID_DEFAULT_TILE_SIZE;
    const diagnostic: Diagnostic = { severity, code, message: "message" };
    const reporter: DiagnosticReporter = () => {};
    const config: WorldConfig = { reporter };

    createDiagnostic(
      DiagnosticDefinitions.WORLD.INVALID_DEFAULT_TILE_SIZE,
      // @ts-expect-error `fallbackTileSize` is required by the template.
      { tileSize: 0 },
    );

    void diagnostic;
    void config;
  }
});

describe("World diagnostics", () => {
  it("reports an invalid default tile size and falls back to 256", () => {
    const reporter = vi.fn<DiagnosticReporter>();
    defaultWorldConfig.tileSize = 0;

    const world = new World({ reporter });

    expect(reporter).toHaveBeenCalledWith({
      severity: "warning",
      code: DiagnosticCodes.WORLD.INVALID_DEFAULT_TILE_SIZE,
      message: "Default world tile size `0` is invalid. Falling back to `256`.",
    });
    expect(world.locatePixel({ x: 256, y: 0 })).toEqual({
      tile: { x: 1, y: 0 },
      local: { x: 0, y: 0 },
    });
  });

  it("uses the default console reporter", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    defaultWorldConfig.tileSize = 0;

    new World();

    expect(warn).toHaveBeenCalledWith(
      "[DC_WORLD_0001] Default world tile size `0` is invalid. Falling back to `256`.",
    );
  });

  it("throws for an explicitly invalid tile size without reporting", () => {
    const reporter = vi.fn<DiagnosticReporter>();
    const run = () => new World({ tileSize: 0, reporter });

    expect(run).toThrow(ReverieRangeError);
    expect(run).toThrow("[EC_COMMON_0003]");
    expect(reporter).not.toHaveBeenCalled();

    try {
      run();
    } catch (error) {
      expect(error).toMatchObject({ code: ErrorCodes.COMMON.UNSAFE_TILE_SIZE });
    }
  });

  it("honors a valid tile size without reporting", () => {
    const reporter = vi.fn<DiagnosticReporter>();
    const world = new World({ tileSize: 128, reporter });

    expect(world.locatePixel({ x: 128, y: 0 })).toEqual({
      tile: { x: 1, y: 0 },
      local: { x: 0, y: 0 },
    });
    expect(reporter).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by a custom reporter", () => {
    const failure = new Error("reporter failed");
    defaultWorldConfig.tileSize = 0;

    expect(() => new World({
      reporter: () => {
        throw failure;
      },
    })).toThrow(failure);
  });
});
