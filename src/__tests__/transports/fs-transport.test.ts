import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { FsTransport } from "../../transports/fs-transport.js";
import { QuiverError } from "../../errors.js";

function tempDir(): string {
  return join(tmpdir(), `fs-transport-test-${randomUUID()}`);
}

describe("FsTransport.fetchBytes", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const d of tmpDirs.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("happy path: reads a file and returns its bytes", async () => {
    const root = tempDir();
    tmpDirs.push(root);
    await mkdir(root, { recursive: true });

    const expected = new Uint8Array([1, 2, 3, 4, 5]);
    await writeFile(join(root, "test.bin"), expected);

    const transport = new FsTransport(root);
    const bytes = await transport.fetchBytes("test.bin");

    expect(bytes).toEqual(expected);
  });

  it("reads a file in a subdirectory", async () => {
    const root = tempDir();
    tmpDirs.push(root);
    await mkdir(join(root, "store"), { recursive: true });

    const expected = new Uint8Array([10, 20, 30]);
    await writeFile(join(root, "store", "abc123"), expected);

    const transport = new FsTransport(root);
    const bytes = await transport.fetchBytes("store/abc123");

    expect(bytes).toEqual(expected);
  });

  it("missing file throws transport_error with cause", async () => {
    const root = tempDir();
    tmpDirs.push(root);
    await mkdir(root, { recursive: true });

    const transport = new FsTransport(root);

    await expect(transport.fetchBytes("does-not-exist.txt")).rejects.toThrow(
      expect.objectContaining({ code: "transport_error" }),
    );

    await expect(transport.fetchBytes("does-not-exist.txt")).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof QuiverError && err.cause !== undefined,
    );
  });

  it("throws a QuiverError instance on failure", async () => {
    const root = tempDir();
    tmpDirs.push(root);
    await mkdir(root, { recursive: true });

    const transport = new FsTransport(root);

    let thrown: unknown;
    try {
      await transport.fetchBytes("nope.bin");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(QuiverError);
    expect((thrown as QuiverError).code).toBe("transport_error");
  });
});
