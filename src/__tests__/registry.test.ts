import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Quiver } from "../quiver.js";
import { QuiverRegistry } from "../registry.js";
import { QuiverError } from "../errors.js";
import type { QuillmarkLike, QuillLike } from "../engine-types.js";
import { makeMockEngine } from "./helpers/mock-engine.js";

// ─── Fixture paths ────────────────────────────────────────────────────────────

const SAMPLE_FIXTURE = new URL("./fixtures/sample-quiver", import.meta.url)
  .pathname;

// ─── Temp-dir helpers for programmatic quivers ───────────────────────────────

const tempDirs: string[] = [];

async function makeTempQuiver(opts: {
  name: string;
  quills: Array<{ name: string; versions: string[] }>;
}): Promise<Quiver> {
  const root = join(tmpdir(), `quiver-registry-test-${randomUUID()}`);
  tempDirs.push(root);

  await mkdir(root, { recursive: true });
  await writeFile(join(root, "Quiver.yaml"), `name: ${opts.name}\n`);

  for (const quill of opts.quills) {
    for (const version of quill.versions) {
      const vDir = join(root, "quills", quill.name, version);
      await mkdir(vDir, { recursive: true });
      await writeFile(join(vDir, "Quill.yaml"), `name: ${quill.name}\n`);
    }
  }

  return Quiver.fromSourceDir(root);
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

// ─── Resolution ──────────────────────────────────────────────────────────────

describe("QuiverRegistry.resolve — single quiver", () => {
  it('1. unqualified "memo" → "memo@1.1.0" (highest)', async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });
    expect(await registry.resolve("memo")).toBe("memo@1.1.0");
  });

  it('2. "memo@1" → "memo@1.1.0" (highest 1.*.*)', async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });
    expect(await registry.resolve("memo@1")).toBe("memo@1.1.0");
  });

  it('3. "memo@1.0" → "memo@1.0.0" (highest 1.0.*)', async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });
    expect(await registry.resolve("memo@1.0")).toBe("memo@1.0.0");
  });

  it('4. "memo@1.0.0" → "memo@1.0.0" (exact)', async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });
    expect(await registry.resolve("memo@1.0.0")).toBe("memo@1.0.0");
  });

  it('5. "memo@2.0.0" (not present) → quill_not_found', async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });
    await expect(registry.resolve("memo@2.0.0")).rejects.toThrow(
      expect.objectContaining({ code: "quill_not_found" }),
    );
  });

  it('6. "memo@^1" → invalid_ref (from parseQuillRef)', async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });
    await expect(registry.resolve("memo@^1")).rejects.toThrow(
      expect.objectContaining({ code: "invalid_ref" }),
    );
  });

  it('7. "" (empty string) → invalid_ref', async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });
    await expect(registry.resolve("")).rejects.toThrow(
      expect.objectContaining({ code: "invalid_ref" }),
    );
  });
});

// ─── Multi-quiver precedence ──────────────────────────────────────────────────

describe("QuiverRegistry.resolve — multi-quiver precedence", () => {
  it("8. first quiver wins even if second has higher version of same quill", async () => {
    // quiver-a has memo@1.0.0; quiver-b has memo@2.0.0 — first (a) wins.
    const quiverA = await makeTempQuiver({
      name: "quiver-a",
      quills: [{ name: "memo", versions: ["1.0.0"] }],
    });
    const quiverB = await makeTempQuiver({
      name: "quiver-b",
      quills: [{ name: "memo", versions: ["2.0.0"] }],
    });
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({
      engine,
      quivers: [quiverA, quiverB],
    });
    // First quiver has "memo" → result must come from quiver-a
    expect(await registry.resolve("memo")).toBe("memo@1.0.0");
  });

  it("9. first quiver lacks quill, second has it → second wins", async () => {
    const quiverA = await makeTempQuiver({
      name: "quiver-a",
      quills: [{ name: "other", versions: ["1.0.0"] }],
    });
    const quiverB = await makeTempQuiver({
      name: "quiver-b",
      quills: [{ name: "memo", versions: ["3.0.0"] }],
    });
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({
      engine,
      quivers: [quiverA, quiverB],
    });
    expect(await registry.resolve("memo")).toBe("memo@3.0.0");
  });

  it("10. neither quiver has quill → quill_not_found", async () => {
    const quiverA = await makeTempQuiver({
      name: "quiver-a",
      quills: [{ name: "other", versions: ["1.0.0"] }],
    });
    const quiverB = await makeTempQuiver({
      name: "quiver-b",
      quills: [{ name: "another", versions: ["1.0.0"] }],
    });
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({
      engine,
      quivers: [quiverA, quiverB],
    });
    await expect(registry.resolve("memo")).rejects.toThrow(
      expect.objectContaining({ code: "quill_not_found" }),
    );
  });
});

// ─── Collision ────────────────────────────────────────────────────────────────

describe("QuiverRegistry constructor — collision detection", () => {
  it("11. two quivers sharing Quiver.yaml.name → quiver_collision at construction", async () => {
    // Both quivers get the same quiver name "alpha".
    const quiverA = await makeTempQuiver({
      name: "alpha",
      quills: [{ name: "foo", versions: ["1.0.0"] }],
    });
    const quiverB = await makeTempQuiver({
      name: "alpha",
      quills: [{ name: "bar", versions: ["1.0.0"] }],
    });
    const { engine } = makeMockEngine();
    expect(
      () => new QuiverRegistry({ engine, quivers: [quiverA, quiverB] }),
    ).toThrow(expect.objectContaining({ code: "quiver_collision" }));
  });

  it("quiver_collision error is a QuiverError instance", async () => {
    const quiverA = await makeTempQuiver({
      name: "beta",
      quills: [{ name: "foo", versions: ["1.0.0"] }],
    });
    const quiverB = await makeTempQuiver({
      name: "beta",
      quills: [{ name: "bar", versions: ["1.0.0"] }],
    });
    const { engine } = makeMockEngine();
    let err: unknown;
    try {
      new QuiverRegistry({ engine, quivers: [quiverA, quiverB] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(QuiverError);
    expect((err as QuiverError).code).toBe("quiver_collision");
  });
});

// ─── getQuill ─────────────────────────────────────────────────────────────────

describe("QuiverRegistry.getQuill", () => {
  it("12. getQuill('memo@1.0.0') returns mock QuillLike; engine.quill called with tree containing Quill.yaml", async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { calls, engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });

    const quill = await registry.getQuill("memo@1.0.0");

    expect(quill).toBeDefined();
    expect(typeof quill.render).toBe("function");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.has("Quill.yaml")).toBe(true);
  });

  it("13. same canonical ref returns cached instance (identity equality)", async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });

    const quill1 = await registry.getQuill("memo@1.0.0");
    const quill2 = await registry.getQuill("memo@1.0.0");

    expect(quill1).toBe(quill2);
  });

  it("13b. engine.quill called exactly once for repeated getQuill of same ref", async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { calls, engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });

    await registry.getQuill("memo@1.0.0");
    await registry.getQuill("memo@1.0.0");

    expect(calls).toHaveLength(1);
  });

  it('14. getQuill("memo") (not canonical) → invalid_ref', async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });

    await expect(registry.getQuill("memo")).rejects.toThrow(
      expect.objectContaining({ code: "invalid_ref" }),
    );
  });

  it('15. getQuill("memo@1.2.3") (version not present) → quill_not_found', async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiver] });

    await expect(registry.getQuill("memo@1.2.3")).rejects.toThrow(
      expect.objectContaining({ code: "quill_not_found" }),
    );
  });

  it("16. if engine.quill throws, error propagates and in-flight entry is cleared (retry works)", async () => {
    const quiver = await Quiver.fromSourceDir(SAMPLE_FIXTURE);
    let callCount = 0;
    const flakyEngine: QuillmarkLike = {
      quill(tree: Map<string, Uint8Array>): QuillLike {
        callCount++;
        if (callCount === 1) {
          throw new Error("engine exploded");
        }
        return { render: () => ({ ok: true }) };
      },
    };
    const registry = new QuiverRegistry({
      engine: flakyEngine,
      quivers: [quiver],
    });

    // First call: engine throws — error propagates.
    await expect(registry.getQuill("memo@1.0.0")).rejects.toThrow(
      "engine exploded",
    );

    // Second call: in-flight cleared, retry succeeds.
    const quill = await registry.getQuill("memo@1.0.0");
    expect(quill).toBeDefined();
    expect(typeof quill.render).toBe("function");
    expect(callCount).toBe(2);
  });
});

// ─── warm ─────────────────────────────────────────────────────────────────────

describe("QuiverRegistry.warm", () => {
  it("17. after warm(), all refs cached; engine.quill call count == total versions across all quivers", async () => {
    const quiverA = await makeTempQuiver({
      name: "quiver-a",
      quills: [
        { name: "memo", versions: ["1.0.0", "1.1.0"] },
        { name: "report", versions: ["2.0.0"] },
      ],
    });
    const quiverB = await makeTempQuiver({
      name: "quiver-b",
      quills: [{ name: "letter", versions: ["3.0.0", "3.1.0"] }],
    });
    const { calls, engine } = makeMockEngine();
    const registry = new QuiverRegistry({
      engine,
      quivers: [quiverA, quiverB],
    });

    await registry.warm();

    // Total versions: memo@1.0.0, memo@1.1.0, report@2.0.0, letter@3.0.0, letter@3.1.0 = 5
    expect(calls).toHaveLength(5);

    // Subsequent getQuill returns cached (identity) — no additional engine.quill calls.
    const memo100 = await registry.getQuill("memo@1.0.0");
    const memo110 = await registry.getQuill("memo@1.1.0");
    const report200 = await registry.getQuill("report@2.0.0");
    const letter300 = await registry.getQuill("letter@3.0.0");
    const letter310 = await registry.getQuill("letter@3.1.0");

    expect(calls).toHaveLength(5); // still 5 — no new calls

    // Second getQuill calls return same instances.
    expect(await registry.getQuill("memo@1.0.0")).toBe(memo100);
    expect(await registry.getQuill("memo@1.1.0")).toBe(memo110);
    expect(await registry.getQuill("report@2.0.0")).toBe(report200);
    expect(await registry.getQuill("letter@3.0.0")).toBe(letter300);
    expect(await registry.getQuill("letter@3.1.0")).toBe(letter310);
  });

  it("17b. warm() is idempotent — second warm() makes no additional engine.quill calls", async () => {
    const quiverA = await makeTempQuiver({
      name: "quiver-warm-idem",
      quills: [{ name: "doc", versions: ["1.0.0"] }],
    });
    const { calls, engine } = makeMockEngine();
    const registry = new QuiverRegistry({ engine, quivers: [quiverA] });

    await registry.warm();
    await registry.warm();

    expect(calls).toHaveLength(1);
  });

  it("18. if engine.quill throws for one ref, warm() rejects (fail-fast)", async () => {
    const quiverA = await makeTempQuiver({
      name: "quiver-fail",
      quills: [
        { name: "alpha", versions: ["1.0.0"] },
        { name: "beta", versions: ["1.0.0"] },
      ],
    });
    let callCount = 0;
    const failingEngine: QuillmarkLike = {
      quill(_tree: Map<string, Uint8Array>): QuillLike {
        callCount++;
        if (callCount === 1) {
          throw new Error("warm failure");
        }
        return { render: () => ({}) };
      },
    };
    const registry = new QuiverRegistry({
      engine: failingEngine,
      quivers: [quiverA],
    });

    await expect(registry.warm()).rejects.toThrow("warm failure");
  });
});
