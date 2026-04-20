/**
 * Minimal structural types matching @quillmark/wasm >=0.57.0 (verified against 0.58.0).
 *
 * Shape:
 *   class Quillmark { quill(tree: Map<string, Uint8Array>): Quill }
 *   class Quill     { render(parsed, opts): RenderResult; open(parsed): RenderSession }
 *
 * These types are INTERNAL — never re-exported from index.ts. They exist so
 * registry.ts never imports from @quillmark/wasm directly and so test doubles
 * can satisfy the contract without pulling the real WASM module.
 *
 * Call-site note: Quiver never invokes `render` or `open` itself; consumers do
 * after `getQuill()`. The loose `unknown` parameter typing is intentional.
 */

export interface QuillmarkLike {
  quill(tree: Map<string, Uint8Array>): QuillLike;
}

export interface QuillLike {
  render(parsed: unknown, opts?: unknown): unknown;
  open?: (parsed: unknown) => unknown;
}
