/**
 * Minimal structural types matching @quillmark/wasm >=0.57.0 (verified against 0.59.0-rc.2).
 *
 * Shape:
 *   class Quillmark { quill(tree: Map<string, Uint8Array>): Quill }
 *   class Quill     { render(doc, opts?): RenderResult; open(doc): RenderSession }
 *
 * Note: as of 0.59.0-rc.2 the first arg to render/open is a `Document` instance
 * (from `Document.fromMarkdown(...)`), not the old `ParsedDocument` interface.
 * Quiver keeps the arg typed as `unknown` so consumers of either shape (and
 * test doubles) satisfy the contract structurally.
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
