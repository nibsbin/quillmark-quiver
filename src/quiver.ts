/**
 * Quiver — primary runtime abstraction for a collection of quills.
 *
 * Polymorphism via composition: internally stores a pluggable loader
 * (either source-backed or packed-backed).
 */

import { QuiverError } from "./errors.js";
import { assertNode } from "./assert-node.js";
import type { FileTree } from "./types.js";
import type { PackOptions } from "./pack.js";
import type { QuiverLoader } from "./quiver-internal.js";
import { PACKED_FACTORY } from "./quiver-internal.js";

/**
 * Internal sentinel used to restrict direct construction.
 * Pass to the constructor to prove you went through a factory.
 */
const INTERNAL = Symbol("Quiver.internal");

/**
 * Source-backed QuiverLoader: reads files from disk via source-loader.
 * Node-only (dynamic imports used inside loadTree to stay browser-safe at
 * module evaluation time).
 */
class SourceLoader implements QuiverLoader {
  constructor(
    private readonly rootDir: string,
    private readonly catalog: ReadonlyMap<string, readonly string[]>,
    private readonly quiverName: string,
  ) {}

  async loadTree(name: string, version: string): Promise<FileTree> {
    const versions = this.catalog.get(name);
    if (!versions || !versions.includes(version)) {
      throw new QuiverError(
        "transport_error",
        `Quill "${name}@${version}" not found in quiver "${this.quiverName}"`,
        { quiverName: this.quiverName, version, ref: `${name}@${version}` },
      );
    }

    const { join } = await import("node:path");
    const { readQuillTree } = await import("./source-loader.js");

    const quillDir = join(this.rootDir, "quills", name, version);
    return readQuillTree(quillDir);
  }
}

export class Quiver {
  readonly name: string;

  readonly #catalog: ReadonlyMap<string, readonly string[]>;
  readonly #loader: QuiverLoader;

  /**
   * Private-ish constructor. Use static factory methods.
   * The `_internal` sentinel prevents accidental direct instantiation.
   */
  constructor(
    _internal: typeof INTERNAL,
    name: string,
    catalog: Map<string, string[]>,
    loader: QuiverLoader,
  ) {
    if (_internal !== INTERNAL) {
      throw new QuiverError(
        "quiver_invalid",
        "Quiver must be created via a factory method (e.g. Quiver.fromSourceDir)",
      );
    }
    this.name = name;

    // Freeze catalog — Quiver instances are immutable after construction.
    const frozen = new Map<string, readonly string[]>();
    for (const [k, v] of catalog) {
      frozen.set(k, Object.freeze([...v]));
    }
    this.#catalog = frozen;
    this.#loader = loader;
  }

  /**
   * Internal factory used by loadPackedQuiver to create a packed-backed Quiver.
   * Keyed by PACKED_FACTORY symbol — not accessible from outside this package.
   */
  static [PACKED_FACTORY](
    name: string,
    catalog: Map<string, string[]>,
    loader: QuiverLoader,
  ): Quiver {
    return new Quiver(INTERNAL, name, catalog, loader);
  }

  /**
   * Node-only factory. Reads a Source Quiver from a directory containing
   * `Quiver.yaml` and `quills/<name>/<version>/Quill.yaml` entries.
   *
   * Uses dynamic import of `./source-loader.js` so that importing this module
   * in a browser environment does not cause a crash at module evaluation time.
   *
   * Throws `quiver_invalid` on schema violations, `transport_error` on I/O failure.
   */
  static async fromSourceDir(path: string): Promise<Quiver> {
    assertNode("Quiver.fromSourceDir");
    const { scanSourceQuiver } = await import("./source-loader.js");
    const { meta, catalog } = await scanSourceQuiver(path);
    const loader = new SourceLoader(path, catalog, meta.name);
    return new Quiver(INTERNAL, meta.name, catalog, loader);
  }

  /**
   * Node-only factory. Loads a Packed Quiver from a local directory.
   *
   * Uses dynamic imports so this module stays browser-safe at evaluation time.
   *
   * Throws `transport_error` on I/O failure, `quiver_invalid` on format errors.
   */
  static async fromPackedDir(path: string): Promise<Quiver> {
    assertNode("Quiver.fromPackedDir");
    const { FsTransport } = await import("./transports/fs-transport.js");
    const { loadPackedQuiver } = await import("./packed-loader.js");
    const transport = new FsTransport(path);
    return loadPackedQuiver(transport);
  }

  /**
   * Browser-safe factory. Loads a Packed Quiver from an HTTP base URL.
   *
   * Throws `transport_error` on network/HTTP failure, `quiver_invalid` on
   * format errors.
   */
  static async fromHttp(url: string): Promise<Quiver> {
    const { HttpTransport } = await import("./transports/http-transport.js");
    const { loadPackedQuiver } = await import("./packed-loader.js");
    const transport = new HttpTransport(url);
    return loadPackedQuiver(transport);
  }

  /** Returns all known quill names, sorted lexicographically. */
  quillNames(): string[] {
    return [...this.#catalog.keys()].sort();
  }

  /**
   * Returns all canonical versions for a given quill name, sorted descending.
   * Returns an empty array if the quill name is not in the catalog.
   */
  versionsOf(name: string): string[] {
    return [...(this.#catalog.get(name) ?? [])];
  }

  /**
   * Node-only tooling. Writes a Packed Quiver artifact to outDir.
   *
   * Uses dynamic import of `./pack.js` so that this module stays browser-safe
   * at evaluation time.
   *
   * Throws `quiver_invalid` on source validation failures,
   * `transport_error` on I/O failures.
   */
  static async pack(
    sourceDir: string,
    outDir: string,
    opts?: PackOptions,
  ): Promise<void> {
    assertNode("Quiver.pack");
    const { packQuiver } = await import("./pack.js");
    return packQuiver(sourceDir, outDir, opts);
  }

  /**
   * Lazily loads the file tree for a specific quill version.
   *
   * Returns `Map<string, Uint8Array>` suitable for `engine.quill(tree)`.
   * Does NOT cache the result — caching is the registry's concern.
   *
   * Throws `transport_error` if name/version not in catalog or I/O fails.
   */
  async loadTree(name: string, version: string): Promise<FileTree> {
    const versions = this.#catalog.get(name);
    if (!versions || !versions.includes(version)) {
      throw new QuiverError(
        "transport_error",
        `Quill "${name}@${version}" not found in quiver "${this.name}"`,
        { quiverName: this.name, version, ref: `${name}@${version}` },
      );
    }
    return this.#loader.loadTree(name, version);
  }
}
