/**
 * Engine tree format utilities.
 *
 * Per the JS/WASM API reference at:
 *   references/quillmark/docs/integration/javascript/api.md
 *
 * `engine.quill(tree)` accepts `Map<string, Uint8Array>` directly — a flat map
 * of relative file paths to raw bytes. No nested JSON or intermediate object
 * shape is required. Therefore `toEngineTree` is an identity pass-through:
 * the FileTree type IS the engine tree format.
 *
 * This module exists as a stable extension point in case the upstream contract
 * changes to require a different shape (e.g. a nested `{ files: { ... } }`
 * object). Callers always go through `toEngineTree`; changing it here is a
 * single-site update.
 */

import type { FileTree } from "./types.js";

/**
 * Converts a flat FileTree to the format expected by `engine.quill(tree)`.
 *
 * Currently a pass-through since `engine.quill` takes `Map<string, Uint8Array>`
 * directly. See references/quillmark/docs/integration/javascript/api.md.
 */
export function toEngineTree(files: FileTree): FileTree {
  return files;
}
