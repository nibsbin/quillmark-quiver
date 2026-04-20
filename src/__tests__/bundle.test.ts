import { describe, it, expect } from "vitest";
import { packFiles, unpackFiles } from "../bundle.js";

const enc = new TextEncoder();

describe("packFiles / unpackFiles", () => {
  it("roundtrips a single file", () => {
    const input = { "a.txt": enc.encode("hello") };
    const zipped = packFiles(input);
    const output = unpackFiles(zipped);
    expect(output["a.txt"]).toEqual(enc.encode("hello"));
  });

  it("roundtrips multiple files", () => {
    const input = {
      "a.txt": enc.encode("hello"),
      "b.txt": enc.encode("world"),
    };
    const zipped = packFiles(input);
    const output = unpackFiles(zipped);
    expect(output["a.txt"]).toEqual(enc.encode("hello"));
    expect(output["b.txt"]).toEqual(enc.encode("world"));
    expect(Object.keys(output).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("roundtrips binary / Uint8Array content faithfully", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const input = { "binary.bin": bytes };
    const output = unpackFiles(packFiles(input));
    expect(output["binary.bin"]).toEqual(bytes);
  });
});

describe("packFiles determinism", () => {
  it("packing the same record twice yields byte-identical output", () => {
    const input = {
      "a.txt": enc.encode("hello"),
      "b.txt": enc.encode("world"),
    };
    const zip1 = packFiles(input);
    const zip2 = packFiles(input);
    expect(zip1).toEqual(zip2);
  });

  it("packing with swapped insertion order yields the same output (keys are sorted)", () => {
    const inputAB = {
      "a.txt": enc.encode("hello"),
      "b.txt": enc.encode("world"),
    };
    const inputBA = {
      "b.txt": enc.encode("world"),
      "a.txt": enc.encode("hello"),
    };
    const zip1 = packFiles(inputAB);
    const zip2 = packFiles(inputBA);
    expect(zip1).toEqual(zip2);
  });

  it("different content produces different output", () => {
    const input1 = { "file.txt": enc.encode("hello") };
    const input2 = { "file.txt": enc.encode("goodbye") };
    expect(packFiles(input1)).not.toEqual(packFiles(input2));
  });

  it("empty record packs and roundtrips", () => {
    const zipped = packFiles({});
    const output = unpackFiles(zipped);
    expect(Object.keys(output)).toHaveLength(0);
  });
});
