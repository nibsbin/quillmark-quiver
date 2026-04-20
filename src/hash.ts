/**
 * MD5 hash helpers — internal, Node-only.
 *
 * Uses dynamic `await import("node:crypto")` so that files that statically
 * import this module don't pull `node:crypto` into browser bundles.
 */

/** Full 32-character MD5 hex digest. */
export async function md5(data: Uint8Array | string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(data).digest("hex");
}

/** First 6 hex characters of the MD5 digest. */
export async function md5Prefix6(data: Uint8Array | string): Promise<string> {
  return (await md5(data)).slice(0, 6);
}
