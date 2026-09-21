/** Delay before releasing an object URL, in milliseconds. */
const OBJECT_URL_REVOCATION_DELAY_MS = 0;

/**
 * Delivers a Blob through a browser download and cleans up all temporary browser
 * resources after the download has been initiated.
 *
 * @param blob - Browser-owned file data to expose through a temporary object URL.
 * @param filename - Suggested file name for the browser download prompt.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    triggerAnchorDownload(objectUrl, filename);
  } finally {
    scheduleObjectUrlRevocation(objectUrl);
  }
}

/** Clicks and removes the temporary anchor even if browser interaction throws. */
function triggerAnchorDownload(objectUrl: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

/** Defers URL release so the browser can begin consuming the object URL first. */
function scheduleObjectUrlRevocation(objectUrl: string): void {
  setTimeout(
    () => URL.revokeObjectURL(objectUrl),
    OBJECT_URL_REVOCATION_DELAY_MS,
  );
}
