/**
 * FsTransport — Node-only packed quiver transport that reads from local disk.
 * Internal; not exported from index.ts.
 *
 * Uses dynamic imports of node:fs/promises and node:path so the module can be
 * imported in environments where those builtins are not available (the dynamic
 * import only executes when fetchBytes is actually called).
 */

import { QuiverError } from "../errors.js";
import type { PackedTransport } from "../packed-loader.js";

export class FsTransport implements PackedTransport {
  constructor(private rootDir: string) {}

  async fetchBytes(relativePath: string): Promise<Uint8Array> {
    const { join } = await import("node:path");
    const { readFile } = await import("node:fs/promises");

    const fullPath = join(this.rootDir, relativePath);
    try {
      const buf = await readFile(fullPath);
      // Ensure we return a plain Uint8Array, not a Node.js Buffer subclass.
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      throw new QuiverError(
        "transport_error",
        `Failed to read "${relativePath}" from packed quiver at "${this.rootDir}": ${(err as Error).message}`,
        { cause: err },
      );
    }
  }
}
