/**
 * Minimal structural types matching the spec'd @quillmark/wasm >=0.57.0 API.
 * The consumer supplies the real Quillmark engine as a peer dep.
 *
 * These types are INTERNAL — never re-exported from index.ts.
 * They decouple registry.ts from the installed @quillmark/wasm@0.55.0,
 * which has the old API (registerQuill / engine.render).
 */

export interface QuillmarkLike {
  quill(tree: Map<string, Uint8Array>): QuillLike;
}

export interface QuillLike {
  render(parsed: unknown, opts?: unknown): unknown;
  // open(parsed) → session — optional, not consumed by registry
}
