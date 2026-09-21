import type { DocumentCompatibility } from "../../interfaces/document/DocumentCompatibility.js";

import {
  CURRENT_DOCUMENT_VERSION,
  MINIMUM_SUPPORTED_DOCUMENT_VERSION,
} from "./DocumentSchema.js";

/** Explicit serialized-format compatibility declaration for document tooling. */
export const DOCUMENT_COMPATIBILITY: DocumentCompatibility = {
  currentVersion: CURRENT_DOCUMENT_VERSION,
  minimumSupportedVersion: MINIMUM_SUPPORTED_DOCUMENT_VERSION,
  writerVersion: CURRENT_DOCUMENT_VERSION,
};
