import { describe, it, expect } from "vitest";
import { Quiver } from "../quiver.js";
import type { QuillmarkLike, QuillLike } from "../engine-types.js";
import { makeMockEngine } from "./helpers/mock-engine.js";

const SAMPLE_FIXTURE = new URL("./fixtures/sample-quiver", import.meta.url)
  .pathname;

// ─── resolve ──────────────────────────────────────────────────────────────────

describe("Quiver.resolve", () => {
  it('1. unqualified "memo" → "memo@1.1.0" (highest)', async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    expect(await quiver.resolve("memo")).toBe("memo@1.1.0");
  });

  it('2. "memo@1" → "memo@1.1.0" (highest 1.*.*)', async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    expect(await quiver.resolve("memo@1")).toBe("memo@1.1.0");
  });

  it('3. "memo@1.0" → "memo@1.0.0" (highest 1.0.*)', async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    expect(await quiver.resolve("memo@1.0")).toBe("memo@1.0.0");
  });

  it('4. "memo@1.0.0" → "memo@1.0.0" (exact)', async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    expect(await quiver.resolve("memo@1.0.0")).toBe("memo@1.0.0");
  });

  it('5. "memo@2.0.0" (not present) → quill_not_found', async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    await expect(quiver.resolve("memo@2.0.0")).rejects.toThrow(
      expect.objectContaining({ code: "quill_not_found" }),
    );
  });

  it('6. "memo@^1" → invalid_ref (from parseQuillRef)', async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    await expect(quiver.resolve("memo@^1")).rejects.toThrow(
      expect.objectContaining({ code: "invalid_ref" }),
    );
  });

  it('7. "" (empty string) → invalid_ref', async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    await expect(quiver.resolve("")).rejects.toThrow(
      expect.objectContaining({ code: "invalid_ref" }),
    );
  });

  it("8. unknown name → quill_not_found", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    await expect(quiver.resolve("nonexistent")).rejects.toThrow(
      expect.objectContaining({ code: "quill_not_found" }),
    );
  });
});

// ─── getQuill ─────────────────────────────────────────────────────────────────

describe("Quiver.getQuill", () => {
  it("9. canonical ref returns mock QuillLike; engine.quill called with tree containing Quill.yaml", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { calls, engine } = makeMockEngine();

    const quill = await quiver.getQuill("memo@1.0.0", { engine });

    expect(quill).toBeDefined();
    expect(typeof quill.render).toBe("function");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.has("Quill.yaml")).toBe(true);
  });

  it("10. selector ref resolves and returns a quill", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();

    const a = await quiver.getQuill("memo", { engine });
    const b = await quiver.getQuill("memo@1.1.0", { engine });

    // Both resolve to memo@1.1.0 → identical cached instance.
    expect(a).toBe(b);
  });

  it("11. same canonical ref returns cached instance (identity equality)", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();

    const quill1 = await quiver.getQuill("memo@1.0.0", { engine });
    const quill2 = await quiver.getQuill("memo@1.0.0", { engine });

    expect(quill1).toBe(quill2);
  });

  it("12. engine.quill called exactly once for repeated getQuill of same ref", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { calls, engine } = makeMockEngine();

    await quiver.getQuill("memo@1.0.0", { engine });
    await quiver.getQuill("memo@1.0.0", { engine });

    expect(calls).toHaveLength(1);
  });

  it("13. concurrent calls for same ref coalesce into one engine.quill call", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { calls, engine } = makeMockEngine();

    const [a, b] = await Promise.all([
      quiver.getQuill("memo@1.0.0", { engine }),
      quiver.getQuill("memo@1.0.0", { engine }),
    ]);

    expect(a).toBe(b);
    expect(calls).toHaveLength(1);
  });

  it("14. distinct engines get distinct cached quills", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { engine: e1 } = makeMockEngine();
    const { engine: e2 } = makeMockEngine();

    const q1 = await quiver.getQuill("memo@1.0.0", { engine: e1 });
    const q2 = await quiver.getQuill("memo@1.0.0", { engine: e2 });

    expect(q1).not.toBe(q2);
  });

  it('15. getQuill("memo@1.2.3") (version not present) → quill_not_found', async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();

    await expect(quiver.getQuill("memo@1.2.3", { engine })).rejects.toThrow(
      expect.objectContaining({ code: "quill_not_found" }),
    );
  });

  it('16. getQuill("memo@^1") (malformed) → invalid_ref', async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { engine } = makeMockEngine();

    await expect(quiver.getQuill("memo@^1", { engine })).rejects.toThrow(
      expect.objectContaining({ code: "invalid_ref" }),
    );
  });

  it("17. if engine.quill throws, error propagates and in-flight entry is cleared (retry works)", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    let callCount = 0;
    const flakyEngine: QuillmarkLike = {
      quill(_tree: Map<string, Uint8Array>): QuillLike {
        callCount++;
        if (callCount === 1) {
          throw new Error("engine exploded");
        }
        return { render: () => ({ ok: true }) };
      },
    };

    await expect(
      quiver.getQuill("memo@1.0.0", { engine: flakyEngine }),
    ).rejects.toThrow("engine exploded");

    const quill = await quiver.getQuill("memo@1.0.0", { engine: flakyEngine });
    expect(quill).toBeDefined();
    expect(typeof quill.render).toBe("function");
    expect(callCount).toBe(2);
  });
});

// ─── warm ─────────────────────────────────────────────────────────────────────

describe("Quiver.warm", () => {
  it("18. after warm(), engine.quill call count == total versions", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { calls, engine } = makeMockEngine();

    await quiver.warm({ engine });

    // Sample fixture: memo@1.0.0, memo@1.1.0, resume@2.0.0 = 3
    expect(calls).toHaveLength(3);

    const memo100 = await quiver.getQuill("memo@1.0.0", { engine });
    const memo110 = await quiver.getQuill("memo@1.1.0", { engine });
    const resume200 = await quiver.getQuill("resume@2.0.0", { engine });

    expect(calls).toHaveLength(3); // still 3 — no new calls

    expect(await quiver.getQuill("memo@1.0.0", { engine })).toBe(memo100);
    expect(await quiver.getQuill("memo@1.1.0", { engine })).toBe(memo110);
    expect(await quiver.getQuill("resume@2.0.0", { engine })).toBe(resume200);
  });

  it("19. warm() is idempotent — second warm() makes no additional engine.quill calls", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
    const { calls, engine } = makeMockEngine();

    await quiver.warm({ engine });
    await quiver.warm({ engine });

    expect(calls).toHaveLength(3);
  });

  it("20. if engine.quill throws for one ref, warm() rejects (fail-fast)", async () => {
    const quiver = await Quiver.fromDir(SAMPLE_FIXTURE);
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

    await expect(quiver.warm({ engine: failingEngine })).rejects.toThrow(
      "warm failure",
    );
  });
});
