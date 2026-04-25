/**
 * Plug-and-play test suite for Quiver authors.
 *
 * Usage (place this file next to your Quiver.yaml):
 *
 *   import { runQuiverTests } from "@quillmark/quiver/testing";
 *   runQuiverTests(import.meta.url);
 *
 * To test with the real @quillmark/wasm engine instead of the mock:
 *
 *   import { Quillmark } from "@quillmark/wasm";
 *   import { runQuiverTests } from "@quillmark/quiver/testing";
 *   const engine = await Quillmark.load();
 *   runQuiverTests(import.meta.url, { engine });
 *
 * Requires vitest in your devDependencies.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Quiver } from "./quiver.js";
import { QuiverRegistry } from "./registry.js";
import type { QuillmarkLike, QuillLike } from "./engine-types.js";

export type { QuillmarkLike, QuillLike };

/**
 * Returns a lightweight mock engine and a record of every tree passed to it.
 * Useful for writing custom assertions on top of the standard suite, or for
 * building your own test helpers.
 */
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

function resolveSourceDir(sourceDirOrMetaUrl: string): string {
  if (sourceDirOrMetaUrl.startsWith("file://")) {
    return fileURLToPath(new URL(".", sourceDirOrMetaUrl));
  }
  return sourceDirOrMetaUrl;
}

function discoverQuills(
  sourceDir: string,
): Array<{ name: string; version: string }> {
  const quillsDir = join(sourceDir, "quills");
  const results: Array<{ name: string; version: string }> = [];

  let nameDirs;
  try {
    nameDirs = readdirSync(quillsDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const nameEntry of nameDirs) {
    if (!nameEntry.isDirectory() || nameEntry.name.startsWith(".")) continue;

    let versionDirs;
    try {
      versionDirs = readdirSync(join(quillsDir, nameEntry.name), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (const versionEntry of versionDirs) {
      if (!versionEntry.isDirectory() || versionEntry.name.startsWith("."))
        continue;
      results.push({ name: nameEntry.name, version: versionEntry.name });
    }
  }

  return results;
}

/**
 * Registers a Vitest describe block that smoke-tests every quill version in
 * the quiver at `sourceDirOrMetaUrl`.
 *
 * Pass `import.meta.url` when your test file lives at the quiver root
 * (next to Quiver.yaml). Pass an absolute directory path for any other layout.
 *
 * Each (quill, version) pair gets its own `it()` so failures are reported
 * individually. The quiver is loaded once in `beforeAll`.
 *
 * With the default mock engine, each test verifies that the file tree loads
 * and is well-formed (valid Quiver.yaml, valid Quill.yaml, no missing files).
 * Pass the real `@quillmark/wasm` engine to also exercise template compilation.
 */
export function runQuiverTests(
  sourceDirOrMetaUrl: string,
  options?: { engine?: QuillmarkLike },
): void {
  const sourceDir = resolveSourceDir(sourceDirOrMetaUrl);
  const engine = options?.engine ?? makeMockEngine().engine;

  // Enumerate quills synchronously so Vitest can collect test cases before
  // any async work begins. Errors here (missing quills/ dir, unreadable dirs)
  // surface as the "has at least one quill" test failing rather than a
  // collection-time crash.
  const quills = discoverQuills(sourceDir);

  describe(`Quiver: ${basename(sourceDir)}`, () => {
    let registry!: QuiverRegistry;

    beforeAll(async () => {
      const quiver = await Quiver.fromSourceDir(sourceDir);
      registry = new QuiverRegistry({ engine, quivers: [quiver] });
    });

    it("has at least one quill", () => {
      expect(quills).not.toHaveLength(0);
    });

    for (const { name, version } of quills) {
      it(`${name}@${version} loads without error`, async () => {
        const quill = await registry.getQuill(`${name}@${version}`);
        expect(typeof quill.render).toBe("function");
      });
    }
  });
}
