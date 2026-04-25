/**
 * Quiver — primary runtime abstraction for a collection of quills.
 *
 * Polymorphism via composition: internally stores a pluggable loader
 * (either source-backed or build-output-backed).
 */

import { QuiverError } from "./errors.js";
import { assertNode } from "./assert-node.js";
import type { BuildOptions } from "./build.js";

/** @internal Internal loader strategy: source or build output. */
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

  /** @internal Used by loadBuiltQuiver. Not part of the public API. */
  static _fromLoader(
    name: string,
    catalog: Map<string, string[]>,
    loader: QuiverLoader,
  ): Quiver {
    return new Quiver(name, catalog, loader);
  }

  /**
   * Node-only factory. Resolves an npm specifier against `node_modules` and
   * loads the source layout at the package root.
   *
   * The resolved package must have `Quiver.yaml` at its root.
   *
   * Throws `transport_error` on resolution/I/O failure, `quiver_invalid`
   * on schema violations.
   */
  static async fromPackage(specifier: string): Promise<Quiver> {
    assertNode("Quiver.fromPackage");
    const { createRequire } = await import("node:module");
    const { dirname } = await import("node:path");
    const req = createRequire(import.meta.url);
    let yamlPath: string;
    try {
      yamlPath = req.resolve(`${specifier}/Quiver.yaml`);
    } catch (err) {
      throw new QuiverError(
        "transport_error",
        `Failed to resolve quiver package "${specifier}": ${(err as Error).message}`,
        { cause: err },
      );
    }
    return Quiver.fromDir(dirname(yamlPath));
  }

  /**
   * Node-only factory. Reads a Source Quiver from a local directory containing
   * `Quiver.yaml` and `quills/<name>/<version>/Quill.yaml` entries.
   *
   * Also accepts `import.meta.url`-style `file://` URLs as a convenience for
   * tests; the URL's parent directory is used as the source root.
   *
   * Throws `quiver_invalid` on schema violations, `transport_error` on I/O failure.
   */
  static async fromDir(pathOrFileUrl: string): Promise<Quiver> {
    assertNode("Quiver.fromDir");
    let dir = pathOrFileUrl;
    if (pathOrFileUrl.startsWith("file://")) {
      const { fileURLToPath } = await import("node:url");
      dir = fileURLToPath(new URL(".", pathOrFileUrl));
    }
    const { scanSourceQuiver, SourceLoader } = await import(
      "./source-loader.js"
    );
    const { meta, catalog } = await scanSourceQuiver(dir);
    const loader = new SourceLoader(dir);
    return new Quiver(meta.name, catalog, loader);
  }

  /**
   * Browser-safe factory. Loads build output from an HTTP/HTTPS URL.
   *
   * Origin-relative URLs (e.g. `/quivers/foo/`) are accepted in browser
   * environments. `file://` URLs are rejected — local build output is
   * not loadable in V1; serve over HTTP or use `fromPackage`/`fromDir`
   * against the source.
   *
   * Throws `transport_error` on network/HTTP failure, `quiver_invalid`
   * on format errors.
   */
  static async fromBuilt(url: string): Promise<Quiver> {
    if (url.startsWith("file://")) {
      throw new QuiverError(
        "transport_error",
        `Quiver.fromBuilt requires an http(s):// or origin-relative URL; got "${url}". Local build output is not loadable in V1 — serve it over HTTP or load source via fromPackage/fromDir.`,
      );
    }
    const { HttpTransport } = await import("./transports/http-transport.js");
    const { loadBuiltQuiver } = await import("./built-loader.js");
    const transport = new HttpTransport(url);
    return loadBuiltQuiver(transport);
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
   * Node-only tooling. Reads the Source Quiver at sourceDir, validates it,
   * and writes the runtime build artifact to outDir.
   *
   * Uses dynamic import of `./build.js` so that this module stays
   * browser-safe at evaluation time.
   *
   * Throws `quiver_invalid` on source validation failures,
   * `transport_error` on I/O failures.
   */
  static async build(
    sourceDir: string,
    outDir: string,
    opts?: BuildOptions,
  ): Promise<void> {
    assertNode("Quiver.build");
    const { buildQuiver } = await import("./build.js");
    return buildQuiver(sourceDir, outDir, opts);
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
