/**
 * Plug-and-play test suite for Quiver authors.
 *
 * Usage (place this file next to your Quiver.yaml):
 *
 *   import { Quillmark } from "@quillmark/wasm";
 *   import { runQuiverTests } from "@quillmark/quiver/testing";
 *   runQuiverTests(import.meta.url, () => Quillmark.load());
 *
 * The engine factory is called in beforeAll, so no top-level await is needed.
 * If you already have an initialized engine instance you can pass it directly:
 *
 *   runQuiverTests(import.meta.url, engine);
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
 * Useful for writing custom test helpers; not intended as a substitute for the
 * real engine in runQuiverTests (the mock performs no template compilation).
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

type EngineArg =
  | QuillmarkLike
  | (() => QuillmarkLike | Promise<QuillmarkLike>);

/**
 * Registers a Vitest describe block that validates every quill version in the
 * quiver at `sourceDirOrMetaUrl` against the provided Quillmark engine.
 *
 * Pass `import.meta.url` when your test file lives at the quiver root (next to
 * Quiver.yaml). Pass an absolute directory path for any other layout.
 *
 * Each (quill, version) pair gets its own `it()` so failures are reported
 * individually. The quiver and engine are initialised once in `beforeAll`.
 *
 * Validation covers the full loading pipeline: Quiver.yaml, Quill.yaml, all
 * template files, and engine compilation via engine.quill(tree). A quill that
 * contains a template error will cause its test to fail with the engine's own
 * error message.
 */
export function runQuiverTests(
  sourceDirOrMetaUrl: string,
  engine: EngineArg,
): void {
  const sourceDir = resolveSourceDir(sourceDirOrMetaUrl);

  // Enumerate quills synchronously so Vitest can collect test cases before
  // any async work begins. Errors here (missing quills/ dir, unreadable dirs)
  // surface as the "has at least one quill" test failing rather than a
  // collection-time crash.
  const quills = discoverQuills(sourceDir);

  describe(`Quiver: ${basename(sourceDir)}`, () => {
    let registry!: QuiverRegistry;

    beforeAll(async () => {
      const resolvedEngine =
        typeof engine === "function" ? await engine() : engine;
      const quiver = await Quiver.fromSourceDir(sourceDir);
      registry = new QuiverRegistry({
        engine: resolvedEngine,
        quivers: [quiver],
      });
    });

    it("has at least one quill", () => {
      expect(quills).not.toHaveLength(0);
    });

    for (const { name, version } of quills) {
      it(`${name}@${version} compiles without error`, async () => {
        const quill = await registry.getQuill(`${name}@${version}`);
        expect(typeof quill.render).toBe("function");
      });
    }
  });
}
