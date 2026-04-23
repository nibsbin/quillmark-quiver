/**
 * Minimal structural types matching @quillmark/wasm >=0.58.2-rc.6.
 *
 * Shape:
 *   class Quillmark { quill(tree: Map<string, Uint8Array>): Quill }
 *   class Quill     { render(doc, opts): RenderResult; open(doc): RenderSession }
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
  render(doc: unknown, opts?: unknown): unknown;
  open?: (doc: unknown) => unknown;
}
