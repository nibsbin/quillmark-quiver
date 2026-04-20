/**
 * Internal-only shared symbols and interfaces used between quiver.ts and
 * packed-loader.ts. Not exported from index.ts or node.ts.
 */

import type { FileTree } from "./types.js";

/**
 * Internal loader interface: pluggable strategy for loading file trees.
 * Source-backed and packed-backed implementations both satisfy this contract.
 */
export interface QuiverLoader {
  loadTree(name: string, version: string): Promise<FileTree>;
}

/**
 * Symbol key used by loadPackedQuiver to call the internal Quiver factory.
 * Keeps the packed factory out of the public API surface.
 */
export const PACKED_FACTORY = Symbol("Quiver.packedFactory");
