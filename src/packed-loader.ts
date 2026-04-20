/**
 * Packed Quiver loader — browser-safe at module level.
 * Internal; not exported from index.ts.
 *
 * Exposes:
 *   - PackedTransport interface (also used by FsTransport / HttpTransport)
 *   - loadPackedQuiver(transport) → Quiver
 *
 * NO static node: imports — this module is safe to load in browser contexts.
 */

import { QuiverError } from "./errors.js";
import { unpackFiles } from "./bundle.js";
import { isCanonicalSemver, compareSemver } from "./semver.js";
import type { FileTree, PackedManifest, PackedQuillEntry } from "./types.js";
import type { QuiverLoader } from "./quiver-internal.js";
import { PACKED_FACTORY } from "./quiver-internal.js";
import { Quiver } from "./quiver.js";

// ─── Public interface (internal to the package) ───────────────────────────────

/**
 * Transport abstraction: fetch raw bytes by relative path within the packed
 * artifact. Implementations are FsTransport (Node) and HttpTransport (browser).
 */
export interface PackedTransport {
  fetchBytes(relativePath: string): Promise<Uint8Array>;
}

// ─── PackedLoader implementation ─────────────────────────────────────────────

class PackedLoader implements QuiverLoader {
  /** Font byte cache: hash → in-flight or resolved Promise. */
  private readonly fontCache: Map<string, Promise<Uint8Array>> = new Map();

  constructor(
    private readonly transport: PackedTransport,
    private readonly manifest: PackedManifest,
  ) {}

  async loadTree(name: string, version: string): Promise<FileTree> {
    const entry = this.manifest.quills.find(
      (q) => q.name === name && q.version === version,
    );

    if (!entry) {
      throw new QuiverError(
        "transport_error",
        `Quill "${name}@${version}" not found in packed quiver manifest`,
        { version, ref: `${name}@${version}` },
      );
    }

    // 1. Fetch + unpack bundle zip.
    const zipBytes = await this.transport.fetchBytes(entry.bundle);
    const files = unpackFiles(zipBytes);

    // 2. Rehydrate fonts from store (coalesced).
    const fontEntries = Object.entries(entry.fonts);
    await Promise.all(
      fontEntries.map(async ([path, hash]) => {
        files[path] = await this.fetchFont(hash);
      }),
    );

    // 3. Convert to FileTree (Map).
    return new Map(Object.entries(files));
  }

  /**
   * Fetch a font by hash from store/<hash>, coalescing concurrent requests for
   * the same hash into a single fetch. On error, removes the cache entry so
   * callers can retry.
   */
  private fetchFont(hash: string): Promise<Uint8Array> {
    let promise = this.fontCache.get(hash);
    if (!promise) {
      promise = this.transport
        .fetchBytes(`store/${hash}`)
        .catch((err: unknown) => {
          this.fontCache.delete(hash);
          throw err;
        });
      this.fontCache.set(hash, promise);
    }
    return promise;
  }
}

// ─── Pointer + manifest validation helpers ────────────────────────────────────

function assertNoUnknownKeys(
  obj: Record<string, unknown>,
  allowed: string[],
  context: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new QuiverError(
        "quiver_invalid",
        `${context}: unknown field "${key}"`,
      );
    }
  }
}

function parsePointer(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new QuiverError("quiver_invalid", "Quiver.json contains invalid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new QuiverError("quiver_invalid", "Quiver.json must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  assertNoUnknownKeys(obj, ["manifest"], "Quiver.json");

  if (typeof obj["manifest"] !== "string" || obj["manifest"].length === 0) {
    throw new QuiverError(
      "quiver_invalid",
      'Quiver.json must have a non-empty string "manifest" field',
    );
  }

  return obj["manifest"] as string;
}

function parseManifest(raw: string): PackedManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new QuiverError(
      "quiver_invalid",
      "Manifest file contains invalid JSON",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new QuiverError("quiver_invalid", "Manifest must be a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  assertNoUnknownKeys(obj, ["version", "name", "quills"], "manifest");

  if (obj["version"] !== 1) {
    throw new QuiverError(
      "quiver_invalid",
      `Manifest version must be 1, got ${String(obj["version"])}`,
    );
  }

  if (typeof obj["name"] !== "string" || obj["name"].length === 0) {
    throw new QuiverError(
      "quiver_invalid",
      'Manifest must have a non-empty string "name" field',
    );
  }

  if (!Array.isArray(obj["quills"])) {
    throw new QuiverError(
      "quiver_invalid",
      'Manifest must have a "quills" array',
    );
  }

  const quills: PackedQuillEntry[] = [];

  for (let i = 0; i < (obj["quills"] as unknown[]).length; i++) {
    const entry = (obj["quills"] as unknown[])[i];

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new QuiverError(
        "quiver_invalid",
        `manifest.quills[${i}] must be an object`,
      );
    }

    const e = entry as Record<string, unknown>;
    assertNoUnknownKeys(
      e,
      ["name", "version", "bundle", "fonts"],
      `manifest.quills[${i}]`,
    );

    if (typeof e["name"] !== "string" || (e["name"] as string).length === 0) {
      throw new QuiverError(
        "quiver_invalid",
        `manifest.quills[${i}].name must be a non-empty string`,
      );
    }

    if (
      typeof e["version"] !== "string" ||
      !isCanonicalSemver(e["version"] as string)
    ) {
      throw new QuiverError(
        "quiver_invalid",
        `manifest.quills[${i}].version must be canonical semver (x.y.z), got "${String(e["version"])}"`,
      );
    }

    if (
      typeof e["bundle"] !== "string" ||
      (e["bundle"] as string).length === 0
    ) {
      throw new QuiverError(
        "quiver_invalid",
        `manifest.quills[${i}].bundle must be a non-empty string`,
      );
    }

    if (
      typeof e["fonts"] !== "object" ||
      e["fonts"] === null ||
      Array.isArray(e["fonts"])
    ) {
      throw new QuiverError(
        "quiver_invalid",
        `manifest.quills[${i}].fonts must be an object`,
      );
    }

    const fonts = e["fonts"] as Record<string, unknown>;
    for (const [k, v] of Object.entries(fonts)) {
      if (typeof v !== "string") {
        throw new QuiverError(
          "quiver_invalid",
          `manifest.quills[${i}].fonts["${k}"] must be a string`,
        );
      }
    }

    quills.push({
      name: e["name"] as string,
      version: e["version"] as string,
      bundle: e["bundle"] as string,
      fonts: fonts as Record<string, string>,
    });
  }

  return {
    version: 1,
    name: obj["name"] as string,
    quills,
  };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Load a Packed Quiver via the given transport.
 *
 * 1. Fetches Quiver.json (pointer) and parses it.
 * 2. Fetches the manifest file it points to and validates it.
 * 3. Builds a catalog from manifest entries (versions sorted descending).
 * 4. Returns a Quiver instance backed by a PackedLoader.
 */
export async function loadPackedQuiver(
  transport: PackedTransport,
): Promise<Quiver> {
  // 1. Fetch and parse pointer.
  let pointerBytes: Uint8Array;
  try {
    pointerBytes = await transport.fetchBytes("Quiver.json");
  } catch (err) {
    if (err instanceof QuiverError) throw err;
    throw new QuiverError(
      "transport_error",
      `Failed to fetch Quiver.json: ${(err as Error).message}`,
      { cause: err },
    );
  }

  const manifestFileName = parsePointer(
    new TextDecoder().decode(pointerBytes),
  );

  // 2. Fetch and parse manifest.
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await transport.fetchBytes(manifestFileName);
  } catch (err) {
    if (err instanceof QuiverError) throw err;
    throw new QuiverError(
      "transport_error",
      `Failed to fetch manifest "${manifestFileName}": ${(err as Error).message}`,
      { cause: err },
    );
  }

  const manifest = parseManifest(new TextDecoder().decode(manifestBytes));

  // 3. Build catalog: name → versions sorted descending.
  const catalogRaw = new Map<string, string[]>();
  for (const entry of manifest.quills) {
    const versions = catalogRaw.get(entry.name) ?? [];
    versions.push(entry.version);
    catalogRaw.set(entry.name, versions);
  }

  for (const [, versions] of catalogRaw) {
    versions.sort((a, b) => compareSemver(b, a));
  }

  // 4. Build loader.
  const loader = new PackedLoader(transport, manifest);

  // 5. Return Quiver via internal factory.
  return Quiver[PACKED_FACTORY](manifest.name, catalogRaw, loader);
}
