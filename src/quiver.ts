/**
 * Quiver — primary runtime abstraction for a collection of quills.
 *
 * Polymorphism via composition: internally stores a pluggable loader
 * (either source-backed or build-output-backed).
 */

import { QuiverError } from "./errors.js";
import { assertNode } from "./assert-node.js";
import type { BuildOptions } from "./build.js";
import type { QuillmarkLike, QuillLike } from "./engine-types.js";
import { parseQuillRef } from "./ref.js";
import { matchesSemverSelector, chooseHighestVersion } from "./semver.js";

/** @internal Internal loader strategy: source or build output. */
export interface QuiverLoader {
  loadTree(name: string, version: string): Promise<Map<string, Uint8Array>>;
}

export class Quiver {
  readonly name: string;

  readonly #catalog: ReadonlyMap<string, readonly string[]>;
  readonly #loader: QuiverLoader;

  /**
   * Per-engine cache of materialized quills, keyed by canonical ref.
   * WeakMap so engines can be GC'd; Promise values so concurrent
   * getQuill calls coalesce into a single load.
   */
  readonly #cache: WeakMap<
    QuillmarkLike,
    Map<string, Promise<QuillLike>>
  > = new WeakMap();

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
   * Does NOT cache the result — caching of materialized Quill instances
   * happens in `getQuill`.
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

  /**
   * Resolves a selector ref → canonical ref (e.g. "memo" → "memo@1.1.0").
   *
   * Selector forms: `name`, `name@x`, `name@x.y`, `name@x.y.z`. Picks the
   * highest matching version in this quiver.
   *
   * Throws:
   *   - `invalid_ref` if ref fails parseQuillRef
   *   - `quill_not_found` if no version matches
   */
  async resolve(ref: string): Promise<string> {
    const parsed = parseQuillRef(ref);
    const versions = this.#catalog.get(parsed.name);

    if (versions && versions.length > 0) {
      const candidates =
        parsed.selector === undefined
          ? [...versions]
          : versions.filter((v) => matchesSemverSelector(v, parsed.selector!));

      if (candidates.length > 0) {
        // chooseHighestVersion returns null only for empty arrays; candidates is non-empty.
        const winner = chooseHighestVersion(candidates)!;
        return `${parsed.name}@${winner}`;
      }
    }

    throw new QuiverError(
      "quill_not_found",
      `No quill found for ref "${ref}" in quiver "${this.name}".`,
      { ref, quiverName: this.name },
    );
  }

  /**
   * Returns a render-ready `Quill` for a ref (selector or canonical).
   *
   * Selector refs (e.g. `"memo"`, `"memo@1"`) are resolved to canonical
   * form first. Materializes via `engine.quill(tree)` on first call;
   * caches per (engine, canonical-ref). Concurrent calls for the same ref
   * coalesce into a single load.
   *
   * Throws:
   *   - `invalid_ref` if ref is malformed
   *   - `quill_not_found` if ref does not match any version in this quiver
   *   - propagates I/O errors from loadTree unchanged
   *   - propagates engine errors from engine.quill() unchanged
   */
  async getQuill(
    ref: string,
    opts: { engine: QuillmarkLike },
  ): Promise<QuillLike> {
    const canonicalRef = await this.resolve(ref);
    const engine = opts.engine;

    let perEngine = this.#cache.get(engine);
    if (perEngine === undefined) {
      perEngine = new Map();
      this.#cache.set(engine, perEngine);
    }

    let entry = perEngine.get(canonicalRef);
    if (entry === undefined) {
      entry = this.#materializeQuill(canonicalRef, engine).catch((err) => {
        perEngine!.delete(canonicalRef);
        throw err;
      });
      perEngine.set(canonicalRef, entry);
    }
    return entry;
  }

  /** Internal: load tree + invoke engine.quill. Errors propagate unchanged. */
  async #materializeQuill(
    canonicalRef: string,
    engine: QuillmarkLike,
  ): Promise<QuillLike> {
    const at = canonicalRef.indexOf("@");
    const name = canonicalRef.slice(0, at);
    const version = canonicalRef.slice(at + 1);
    const tree = await this.loadTree(name, version);
    return engine.quill(tree);
  }

  /**
   * Warms every quill version in this quiver against `engine`. Fail-fast.
   *
   * Calls `getQuill` for every (name, version) in parallel. Already-cached
   * refs resolve instantly (idempotent). Rejects on the first failure.
   */
  async warm(opts: { engine: QuillmarkLike }): Promise<void> {
    const promises: Promise<QuillLike>[] = [];
    for (const name of this.quillNames()) {
      for (const version of this.versionsOf(name)) {
        promises.push(this.getQuill(`${name}@${version}`, opts));
      }
    }
    await Promise.all(promises);
  }
}
