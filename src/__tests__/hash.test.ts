import { describe, it, expect } from "vitest";
import { md5, md5Prefix6 } from "../hash.js";

describe("md5", () => {
  it("returns the correct digest for an empty string", async () => {
    expect(await md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("returns the correct digest for 'hello'", async () => {
    expect(await md5("hello")).toBe("5d41402abc4b2a76b9719d911017c592");
  });

  it("returns a 32-character lowercase hex string", async () => {
    const result = await md5("test");
    expect(result).toHaveLength(32);
    expect(result).toMatch(/^[0-9a-f]{32}$/);
  });

  it("accepts Uint8Array and produces the same hash as the equivalent string", async () => {
    const str = "hello";
    const bytes = new TextEncoder().encode(str);
    expect(await md5(bytes)).toBe(await md5(str));
  });

  it("produces the same hash for equivalent Uint8Array and string inputs (empty)", async () => {
    const bytes = new TextEncoder().encode("");
    expect(await md5(bytes)).toBe(await md5(""));
  });
});

describe("md5Prefix6", () => {
  it("returns the first 6 hex chars of the MD5 of 'hello'", async () => {
    expect(await md5Prefix6("hello")).toBe("5d4140");
  });

  it("returns exactly 6 characters", async () => {
    const result = await md5Prefix6("arbitrary content");
    expect(result).toHaveLength(6);
    expect(result).toMatch(/^[0-9a-f]{6}$/);
  });

  it("prefix is consistent with full md5 output", async () => {
    const full = await md5("quiver");
    const prefix = await md5Prefix6("quiver");
    expect(full.startsWith(prefix)).toBe(true);
  });

  it("accepts Uint8Array", async () => {
    const bytes = new TextEncoder().encode("hello");
    expect(await md5Prefix6(bytes)).toBe("5d4140");
  });
});
