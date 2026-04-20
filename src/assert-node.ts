import { QuiverError } from "./errors.js";

/**
 * Throws a `transport_error` when called outside a Node.js environment.
 * Call at the top of each Node-only static factory to fail fast in browsers.
 */
export function assertNode(method: string): void {
  if (
    typeof globalThis.process === "undefined" ||
    !(globalThis as { process?: { versions?: { node?: string } } }).process
      ?.versions?.node
  ) {
    throw new QuiverError(
      "transport_error",
      `${method} is only available in Node.js`,
    );
  }
}
