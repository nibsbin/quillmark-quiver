/**
 * Quiver — primary runtime abstraction for a collection of quills.
 *
 * Polymorphism via composition: internally stores a pluggable loader
 * (either source-backed or packed-backed).
 */

import { QuiverError } from "./errors.js";
import { assertNode } from "./assert-node.js";
import type { PackOptions } from "./pack.js";

/** @internal Internal loader strategy: source or packed. */
export interface QuiverLoader {
  loadTree(name: string, version: string): Promise<Map<string, Uint8Array>>;
}

export class Quiver {
  readonly name: string;

  readonly #catalog: ReadonlyMap<string, readonly string[]>;
  readonly #loader: QuiverLoader;

  /**
   * Private constructor — use static factory methods.
   * TS prevents external `new Quiver(...)` at compile time.
   * Static methods inside can still call it.
   */
  private constructor(
    name: string,
    catalog: Map<string, string[]>,
    loader: QuiverLoader,
  ) {
    this.name = name;
    this.#catalog = new Map(catalog);
    this.#loader = loader;
  }

  /** @internal Used by loadPackedQuiver. Not part of the public API. */
  static _fromLoader(
    name: string,
    catalog: Map<string, string[]>,
    loader: QuiverLoader,
  ): Quiver {
    return new Quiver(name, catalog, loader);
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
    const { scanSourceQuiver, SourceLoader } = await import(
      "./source-loader.js"
    );
    const { meta, catalog } = await scanSourceQuiver(path);
    const loader = new SourceLoader(path);
    return new Quiver(meta.name, catalog, loader);
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
  async loadTree(name: string, version: string): Promise<Map<string, Uint8Array>> {
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
