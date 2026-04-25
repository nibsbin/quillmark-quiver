/**
 * Integration tests — build → fromBuilt (mock fetch) → resolve → getQuill →
 * mock render.
 *
 * Built artifacts are loaded over HTTP only (Quiver.fromBuilt accepts
 * http(s):// URLs); these tests mock globalThis.fetch to serve files
 * from a temporary directory written by Quiver.build.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Quiver } from "../node.js";
import { QuiverError } from "../errors.js";
import { makeMockEngine } from "./helpers/mock-engine.js";

// ─── Fixture ──────────────────────────────────────────────────────────────────

const SAMPLE_FIXTURE = new URL("./fixtures/sample-quiver", import.meta.url)
  .pathname;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tempDir(): string {
  return join(tmpdir(), `quiver-integration-test-${randomUUID()}`);
}

/**
 * Mock globalThis.fetch to serve files from a build-output directory on disk.
 * URL pattern: baseUrl + relativePath (with one slash between them).
 */
function makeMockFetch(
  dir: string,
  baseUrl: string,
): { restore: () => void } {
  const original = globalThis.fetch;
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  globalThis.fetch = (async (url: string) => {
    if (!url.startsWith(base)) {
      return new Response(null, { status: 404 });
    }
    const relativePath = url.slice(base.length);
    const filePath = join(dir, relativePath);
    try {
      const bytes = await readFile(filePath);
      return new Response(bytes.buffer, { status: 200 });
    } catch {
      return new Response(null, { status: 404 });
    }
  }) as typeof globalThis.fetch;

  return {
    restore: () => {
      if (original !== undefined) {
        globalThis.fetch = original;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).fetch;
      }
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Integration: build → fromBuilt → resolve → getQuill", () => {
  const tmpDirs: string[] = [];
  let mockFetch: { restore: () => void } | undefined;

  afterEach(async () => {
    if (mockFetch !== undefined) {
      mockFetch.restore();
      mockFetch = undefined;
    }
    for (const d of tmpDirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("fromBuilt catalog matches source quiver", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.build(SAMPLE_FIXTURE, outDir);

    const baseUrl = "https://mock.cdn.example.com/my-quiver/";
    mockFetch = makeMockFetch(outDir, baseUrl);

    const built = await Quiver.fromBuilt(baseUrl);

    expect(built.name).toBe("sample");
    expect(built.quillNames().sort()).toEqual(["memo", "resume"]);
    expect(built.versionsOf("memo").sort()).toEqual(["1.0.0", "1.1.0"]);
    expect(built.versionsOf("resume")).toEqual(["2.0.0"]);
  });

  it("quiver.resolve works with built quiver", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.build(SAMPLE_FIXTURE, outDir);

    const baseUrl = "https://mock.cdn.example.com/my-quiver/";
    mockFetch = makeMockFetch(outDir, baseUrl);

    const built = await Quiver.fromBuilt(baseUrl);

    expect(await built.resolve("memo")).toBe("memo@1.1.0");
    expect(await built.resolve("memo@1.0.0")).toBe("memo@1.0.0");
    expect(await built.resolve("resume")).toBe("resume@2.0.0");
  });

  it("quiver.getQuill returns a mock quill with correct tree", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.build(SAMPLE_FIXTURE, outDir);

    const baseUrl = "https://mock.cdn.example.com/my-quiver/";
    mockFetch = makeMockFetch(outDir, baseUrl);

    const built = await Quiver.fromBuilt(baseUrl);
    const { calls, engine } = makeMockEngine();

    const quill = await built.getQuill("memo@1.0.0", { engine });

    expect(quill).toBeDefined();
    expect(typeof quill.render).toBe("function");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.has("Quill.yaml")).toBe(true);
  });

  it("quiver.getQuill for unknown version throws quill_not_found", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.build(SAMPLE_FIXTURE, outDir);

    const baseUrl = "https://mock.cdn.example.com/my-quiver/";
    mockFetch = makeMockFetch(outDir, baseUrl);

    const built = await Quiver.fromBuilt(baseUrl);
    const { engine } = makeMockEngine();

    await expect(built.getQuill("memo@9.9.9", { engine })).rejects.toThrow(
      expect.objectContaining({ code: "quill_not_found" }),
    );
  });
});

describe("Integration: fromBuilt error cases", () => {
  let mockFetch: { restore: () => void } | undefined;
  const tmpDirs: string[] = [];

  afterEach(async () => {
    if (mockFetch !== undefined) {
      mockFetch.restore();
      mockFetch = undefined;
    }
    for (const d of tmpDirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("fromBuilt with non-existent base URL throws transport_error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(null, { status: 404 })) as typeof globalThis.fetch;
    mockFetch = {
      restore: () => {
        if (original !== undefined) globalThis.fetch = original;
      },
    };

    await expect(
      Quiver.fromBuilt("https://does-not-exist.example.com/quiver/"),
    ).rejects.toThrow(expect.objectContaining({ code: "transport_error" }));
  });

  it("fromBuilt with empty directory served over HTTP throws transport_error", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);
    await mkdir(outDir, { recursive: true });

    const baseUrl = "https://mock.cdn.example.com/empty/";
    mockFetch = makeMockFetch(outDir, baseUrl);

    await expect(Quiver.fromBuilt(baseUrl)).rejects.toThrow(
      expect.objectContaining({ code: "transport_error" }),
    );
  });

  it("fromBuilt with malformed Quiver.json throws quiver_invalid", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);
    await mkdir(outDir, { recursive: true });

    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(outDir, "Quiver.json"), "not-json");

    const baseUrl = "https://mock.cdn.example.com/malformed/";
    mockFetch = makeMockFetch(outDir, baseUrl);

    await expect(Quiver.fromBuilt(baseUrl)).rejects.toThrow(
      expect.objectContaining({ code: "quiver_invalid" }),
    );
  });

  it("fromBuilt throws QuiverError on missing pointer", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);
    await mkdir(outDir, { recursive: true });

    const baseUrl = "https://mock.cdn.example.com/missing/";
    mockFetch = makeMockFetch(outDir, baseUrl);

    let thrown: unknown;
    try {
      await Quiver.fromBuilt(baseUrl);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(QuiverError);
  });

  it("fromBuilt rejects file:// URLs with transport_error", async () => {
    await expect(
      Quiver.fromBuilt("file:///tmp/quiver/"),
    ).rejects.toThrow(expect.objectContaining({ code: "transport_error" }));
  });
});
