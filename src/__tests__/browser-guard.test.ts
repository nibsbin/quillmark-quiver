/**
 * Browser-guard tests.
 *
 * Verifies that assertNode() — and therefore the three Node-only factories
 * (fromPackage, fromDir, build) — throw a QuiverError with code
 * `transport_error` and a message containing "Node.js" when `process` is not
 * available (i.e. in a simulated browser environment).
 */

import { describe, it, expect, afterEach } from "vitest";
import { assertNode } from "../assert-node.js";
import { QuiverError } from "../errors.js";

// ---------------------------------------------------------------------------
// Helpers for shadowing globalThis.process
// ---------------------------------------------------------------------------

/**
 * Temporarily masks `globalThis.process` so that assertNode() believes it is
 * running in a non-Node environment.  Returns a restore function.
 *
 * We use Object.defineProperty with a configurable value descriptor so that
 * the property can be redefined back to the original value afterwards.
 */
function maskProcess(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "process");

  Object.defineProperty(globalThis, "process", {
    value: undefined,
    writable: true,
    configurable: true,
  });

  return () => {
    if (original) {
      Object.defineProperty(globalThis, "process", original);
    } else {
      // Defensive: if there was no own descriptor, just delete our override.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (globalThis as any).process;
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assertNode – browser guard", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("does not throw in Node.js (sanity check)", () => {
    expect(() => assertNode("Test.method")).not.toThrow();
  });

  it("throws transport_error with 'Node.js' message when process is undefined", () => {
    restore = maskProcess();

    expect(() => assertNode("Quiver.fromDir")).toThrow(QuiverError);

    try {
      assertNode("Quiver.fromDir");
    } catch (err) {
      expect(err).toBeInstanceOf(QuiverError);
      const qe = err as QuiverError;
      expect(qe.code).toBe("transport_error");
      expect(qe.message).toContain("Node.js");
    }
  });

});
