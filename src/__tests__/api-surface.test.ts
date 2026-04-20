/**
 * API surface test.
 *
 * Verifies that the public entrypoints (`src/index.ts` and `src/node.ts`)
 * export exactly the documented runtime values:
 *   - Quiver
 *   - QuiverRegistry
 *   - QuiverError
 *
 * Type-only exports (`QuiverErrorCode`, `PackOptions`) produce no runtime
 * binding and therefore do not appear in `Object.keys(module)`.
 */

import { describe, it, expect } from "vitest";
import * as mainExports from "../index.js";
import * as nodeExports from "../node.js";

const EXPECTED_RUNTIME_KEYS = ["Quiver", "QuiverRegistry", "QuiverError"].sort();

describe("API surface – src/index.ts (main entrypoint)", () => {
  it("exports exactly Quiver, QuiverRegistry, QuiverError at runtime", () => {
    const actual = Object.keys(mainExports).sort();
    expect(actual).toEqual(EXPECTED_RUNTIME_KEYS);
  });

  it("exports Quiver as a constructor/class", () => {
    expect(typeof mainExports.Quiver).toBe("function");
  });

  it("exports QuiverRegistry as a constructor/class", () => {
    expect(typeof mainExports.QuiverRegistry).toBe("function");
  });

  it("exports QuiverError as a constructor/class", () => {
    expect(typeof mainExports.QuiverError).toBe("function");
  });
});

describe("API surface – src/node.ts (node entrypoint)", () => {
  it("re-exports the same runtime keys as the main entrypoint", () => {
    const actual = Object.keys(nodeExports).sort();
    expect(actual).toEqual(EXPECTED_RUNTIME_KEYS);
  });

  it("Quiver from node entrypoint is the same class as from main", () => {
    expect(nodeExports.Quiver).toBe(mainExports.Quiver);
  });

  it("QuiverRegistry from node entrypoint is the same class as from main", () => {
    expect(nodeExports.QuiverRegistry).toBe(mainExports.QuiverRegistry);
  });

  it("QuiverError from node entrypoint is the same class as from main", () => {
    expect(nodeExports.QuiverError).toBe(mainExports.QuiverError);
  });
});
