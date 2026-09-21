/** One named binary entry emitted into or read from a project container. */
export interface ProjectContainerEntry {
  /** Unique, normalized entry path. */
  readonly name: string;

  /** Raw entry bytes. */
  readonly data: Uint8Array;
}
