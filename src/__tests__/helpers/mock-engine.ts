import type { QuillmarkLike, QuillLike } from "../../engine-types.js";

/** In-test mock for the Quillmark engine. Records every `engine.quill(tree)` call. */
export function makeMockEngine(): {
  calls: Array<Map<string, Uint8Array>>;
  engine: QuillmarkLike;
} {
  const calls: Array<Map<string, Uint8Array>> = [];
  const engine: QuillmarkLike = {
    quill(tree: Map<string, Uint8Array>): QuillLike {
      calls.push(tree);
      return { render: () => ({ ok: true }) };
    },
  };
  return { calls, engine };
}
