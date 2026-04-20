/**
 * Phase 5 integration tests — pack → fromPackedDir / fromHttp → registry →
 * resolve → getQuill → mock render.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Quiver } from "../quiver.js";
import { QuiverRegistry } from "../registry.js";
import { QuiverError } from "../errors.js";
import { makeMockEngine } from "./helpers/mock-engine.js";

// ─── Fixture ──────────────────────────────────────────────────────────────────

const SAMPLE_FIXTURE = new URL("./fixtures/sample-quiver", import.meta.url)
  .pathname;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tempDir(): string {
  return join(tmpdir(), `quiver-integration-test-${randomUUID()}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Integration: pack → fromPackedDir → registry → resolve → getQuill", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const d of tmpDirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("fromPackedDir catalog matches source quiver", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.pack(SAMPLE_FIXTURE, outDir);
    const packed = await Quiver.fromPackedDir(outDir);

    expect(packed.name).toBe("sample");
    expect(packed.quillNames().sort()).toEqual(["memo", "resume"]);
    expect(packed.versionsOf("memo").sort()).toEqual(["1.0.0", "1.1.0"]);
    expect(packed.versionsOf("resume")).toEqual(["2.0.0"]);
  });

  it("registry.resolve works with packed quiver", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.pack(SAMPLE_FIXTURE, outDir);
    const packed = await Quiver.fromPackedDir(outDir);

    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [packed] });

    expect(await registry.resolve("memo")).toBe("memo@1.1.0");
    expect(await registry.resolve("memo@1.0.0")).toBe("memo@1.0.0");
    expect(await registry.resolve("resume")).toBe("resume@2.0.0");
  });

  it("registry.getQuill returns a mock quill with correct tree", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.pack(SAMPLE_FIXTURE, outDir);
    const packed = await Quiver.fromPackedDir(outDir);

    const { calls, engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [packed] });

    const quill = await registry.getQuill("memo@1.0.0");

    expect(quill).toBeDefined();
    expect(typeof quill.render).toBe("function");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.has("Quill.yaml")).toBe(true);
  });

  it("registry.getQuill for unknown version throws quill_not_found", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.pack(SAMPLE_FIXTURE, outDir);
    const packed = await Quiver.fromPackedDir(outDir);

    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [packed] });

    await expect(registry.getQuill("memo@9.9.9")).rejects.toThrow(
      expect.objectContaining({ code: "quill_not_found" }),
    );
  });
});

describe("Integration: pack → fromHttp (mock fetch) → registry → resolve → getQuill", () => {
  const tmpDirs: string[] = [];
  let originalFetch: typeof globalThis.fetch | undefined;

  afterEach(async () => {
    // Restore fetch.
    if (originalFetch !== undefined) {
      globalThis.fetch = originalFetch;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).fetch;
    }
    // Clean up temp dirs.
    for (const d of tmpDirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  /**
   * Mock globalThis.fetch to serve files from a packed directory on disk.
   * URL pattern: baseUrl + relativePath (with one slash between them).
   */
  function mockFetchFromDir(dir: string, baseUrl: string): void {
    originalFetch = globalThis.fetch;
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
  }

  it("fromHttp catalog matches source quiver", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.pack(SAMPLE_FIXTURE, outDir);

    const baseUrl = "https://mock.cdn.example.com/my-quiver/";
    mockFetchFromDir(outDir, baseUrl);

    const packed = await Quiver.fromHttp(baseUrl);

    expect(packed.name).toBe("sample");
    expect(packed.quillNames().sort()).toEqual(["memo", "resume"]);
    expect(packed.versionsOf("memo").sort()).toEqual(["1.0.0", "1.1.0"]);
  });

  it("registry.resolve and getQuill work with fromHttp quiver", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);

    await Quiver.pack(SAMPLE_FIXTURE, outDir);

    const baseUrl = "https://mock.cdn.example.com/my-quiver";
    mockFetchFromDir(outDir, baseUrl);

    const packed = await Quiver.fromHttp(baseUrl);

    const { calls, engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [packed] });

    const ref = await registry.resolve("memo");
    expect(ref).toBe("memo@1.1.0");

    const quill = await registry.getQuill(ref);
    expect(quill).toBeDefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.has("Quill.yaml")).toBe(true);
  });

  it("fromHttp with non-existent base URL throws transport_error", async () => {
    originalFetch = globalThis.fetch;

    globalThis.fetch = (async () =>
      new Response(null, { status: 404 })) as typeof globalThis.fetch;

    await expect(
      Quiver.fromHttp("https://does-not-exist.example.com/quiver/"),
    ).rejects.toThrow(expect.objectContaining({ code: "transport_error" }));
  });
});

describe("Integration: fromPackedDir error cases", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const d of tmpDirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("fromPackedDir with empty directory throws transport_error", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);
    await mkdir(outDir, { recursive: true });

    await expect(Quiver.fromPackedDir(outDir)).rejects.toThrow(
      expect.objectContaining({ code: "transport_error" }),
    );
  });

  it("fromPackedDir with malformed Quiver.json throws quiver_invalid", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);
    await mkdir(outDir, { recursive: true });

    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(outDir, "Quiver.json"), "not-json");

    await expect(Quiver.fromPackedDir(outDir)).rejects.toThrow(
      expect.objectContaining({ code: "quiver_invalid" }),
    );
  });

  it("fromPackedDir throws QuiverError", async () => {
    const outDir = tempDir();
    tmpDirs.push(outDir);
    await mkdir(outDir, { recursive: true });

    let thrown: unknown;
    try {
      await Quiver.fromPackedDir(outDir);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(QuiverError);
  });
});
