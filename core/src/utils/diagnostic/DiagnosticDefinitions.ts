import type { DiagnosticDefinition } from "../../interfaces/diagnostic/Diagnostic.js";
import { deriveDefinitionCodes } from "../definitions/DeriveDefinitionCodes.js";

/**
 * Internal source of truth for non-fatal diagnostic metadata.
 *
 * Codes are permanent public identifiers; templates and severities may evolve.
 */
export const DiagnosticDefinitions = {
  WORLD: {
    INVALID_DEFAULT_TILE_SIZE: {
      severity: "warning",
      code: "DC_WORLD_0001",
      template:
        "Default world tile size `$tileSize` is invalid. Falling back to `$fallbackTileSize`.",
    },
  },
} as const satisfies Record<string, Record<string, DiagnosticDefinition>>;

/** Immutable diagnostic-code catalog exposed without internal message metadata. */
export const DiagnosticCodes = deriveDefinitionCodes(DiagnosticDefinitions);
