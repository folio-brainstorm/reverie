import { vi } from "vitest";

/**
 * Anchor element fake recording the download request it represents.
 *
 * It implements only the members the download helper touches, so a test can see
 * exactly which file name and object URL reached the browser.
 */
export class TestDownloadAnchor {
  /** Object URL the anchor points at. */
  href = "";

  /** File name the browser was asked to propose. */
  download = "";

  /** Link relation applied to the temporary download anchor. */
  rel = "";

  /** Whether the browser was asked to start the download. */
  hasClicked = false;

  /** Whether the temporary node was removed from the document again. */
  isRemoved = false;

  /** Failure thrown by the next `click()`, used to simulate a blocked download. */
  clickFailure: Error | null = null;

  /**
   * Records that the browser started the download.
   *
   * @throws {Error} The test marked this anchor's click as failing.
   */
  click(): void {
    if (this.clickFailure !== null) {
      throw this.clickFailure;
    }

    this.hasClicked = true;
  }

  /** Records that the temporary node left the document. */
  remove(): void {
    this.isRemoved = true;
  }
}

/**
 * Records the browser download primitives a Web export test observes.
 *
 * The helper installs only the global `document` and `URL` functions the
 * download path uses; the drawing runtime reaches its own document through
 * `canvas.ownerDocument`, so the two fakes never overlap.
 */
export class DownloadTestRuntime {
  /** Anchors created through the stubbed document, in creation order. */
  readonly anchors: TestDownloadAnchor[] = [];

  /** Anchors appended to the stubbed document body, in append order. */
  readonly appendedAnchors: TestDownloadAnchor[] = [];

  /** Object URLs created through the stubbed URL, in creation order. */
  readonly createdObjectUrls: string[] = [];

  /** Object URLs revoked through the stubbed URL, in revocation order. */
  readonly revokedObjectUrls: string[] = [];

  /** Blobs wrapped in each object URL, in creation order. */
  readonly blobs: Blob[] = [];

  private nextObjectUrlId = 0;
  private shouldFailNextClick = false;

  /**
   * Substitutes the global `document` and `URL` a download requires.
   *
   * Only anchor creation and body appends are served, because nothing else in the
   * export path reaches the global document.
   */
  install(): void {
    vi.stubGlobal("document", {
      createElement: (tagName: string): TestDownloadAnchor => {
        if (tagName !== "a") {
          throw new Error(`Unexpected element request: ${tagName}`);
        }

        return this.createAnchor();
      },
      body: {
        append: (anchor: TestDownloadAnchor): void => {
          this.appendedAnchors.push(anchor);
        },
      },
    });

    // Keep the URL constructor available for codec asset resolution.
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob): string =>
      this.registerObjectUrl(blob),
    );
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(
      (objectUrl: string): void => {
        this.revokedObjectUrls.push(objectUrl);
      },
    );
  }

  /** Makes the next anchor click throw, simulating a blocked download. */
  failNextClick(): void {
    this.shouldFailNextClick = true;
  }

  /** Creates and records the anchor the stubbed document hands out. */
  private createAnchor(): TestDownloadAnchor {
    const anchor = new TestDownloadAnchor();

    if (this.shouldFailNextClick) {
      anchor.clickFailure = new Error("Download was blocked.");
      this.shouldFailNextClick = false;
    }

    this.anchors.push(anchor);

    return anchor;
  }

  /** Registers a Blob under a fresh deterministic object URL. */
  private registerObjectUrl(blob: Blob): string {
    const objectUrl = `blob:reverie/${this.nextObjectUrlId}`;
    this.nextObjectUrlId += 1;
    this.blobs.push(blob);
    this.createdObjectUrls.push(objectUrl);

    return objectUrl;
  }
}

/**
 * Waits for zero-delay timers scheduled before this call to run.
 *
 * Object URLs are revoked on a later task, so assertions about revocation must
 * yield once while the stubbed `URL` is still installed.
 */
export async function flushScheduledTimers(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
