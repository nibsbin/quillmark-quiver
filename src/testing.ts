/**
 * Convenience test harness for Quiver authors using `node:test`.
 *
 * Built into Node 18+; no extra test-runner dependency required. If you
 * prefer vitest, jest, or another runner, write a 12-line loop against
 * the main API instead — every primitive used here is public.
 *
 * Usage (place this file next to your Quiver.yaml):
 *
 *   import { Quillmark } from "@quillmark/wasm";
 *   import { runQuiverTests } from "@quillmark/quiver/testing";
 *   const engine = await Quillmark.load();
 *   runQuiverTests(import.meta.url, engine);
 *
 * Run with `node --test`.
 */

import { describe, it, before } from "node:test";
import { Quiver } from "./quiver.js";
import type { QuillmarkLike } from "./engine-types.js";

/**
 * Registers a `node:test` describe block that validates every quill
 * version in the quiver at `metaUrlOrDir` against the provided engine.
 *
 * Pass `import.meta.url` when this file lives at the quiver root (next
 * to Quiver.yaml). Pass an absolute directory path for any other layout.
 *
 * Validation covers the full loading pipeline: Quiver.yaml, Quill.yaml,
 * all template files, and engine compilation via engine.quill(tree).
 */
export function runQuiverTests(
  metaUrlOrDir: string,
  engine: QuillmarkLike,
): void {
  describe("Quiver", () => {
    let quiver!: Quiver;

    before(async () => {
      quiver = await Quiver.fromDir(metaUrlOrDir);
    });

    it("has at least one quill", () => {
      if (quiver.quillNames().length === 0) {
        throw new Error("Quiver has no quills");
      }
    });

    it("compiles every quill version without error", async () => {
      for (const name of quiver.quillNames()) {
        for (const version of quiver.versionsOf(name)) {
          const quill = await quiver.getQuill(`${name}@${version}`, { engine });
          if (typeof quill.render !== "function") {
            throw new Error(
              `${name}@${version}: engine returned non-conforming Quill`,
            );
          }
        }
      }
    });
  });
}
