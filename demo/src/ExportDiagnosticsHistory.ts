import type { DiagnosticsHistorySample } from "./interfaces/diagnostics/DiagnosticsHistorySample";

/** Downloads the demo's retained render snapshots as a readable JSON file. */
export function exportDiagnosticsHistory(
  samples: readonly DiagnosticsHistorySample[],
): void {
  const payload = {
    format: "reverie-demo-diagnostics-history",
    version: 1,
    samples,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = "reverie-diagnostics-history.json";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
