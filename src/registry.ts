import { QuiverError } from "./errors.js";
import type { QuillmarkLike, QuillLike } from "./engine-types.js";
import type { Quiver } from "./quiver.js";
import { parseQuillRef } from "./ref.js";
import { matchesSemverSelector, chooseHighestVersion } from "./semver.js";

export class QuiverRegistry {
  readonly #engine: QuillmarkLike;
  readonly #quivers: readonly Quiver[];

  /** Cache: canonical ref → resolved QuillLike instance. */
  readonly #cache: Map<string, QuillLike> = new Map();

  /** In-flight dedup: canonical ref → pending Promise<QuillLike>. */
  readonly #inflight: Map<string, Promise<QuillLike>> = new Map();

  constructor(args: { engine: QuillmarkLike; quivers: Quiver[] }) {
    this.#engine = args.engine;

    // Validate no two quivers share Quiver.yaml.name → quiver_collision.
    const seen = new Map<string, string>();
    for (const quiver of args.quivers) {
      const existing = seen.get(quiver.name);
      if (existing !== undefined) {
        throw new QuiverError(
          "quiver_collision",
          `Two quivers share the name "${quiver.name}": first quiver and a later quiver both declare this name. ` +
            `Quiver names must be unique within a registry.`,
          { quiverName: quiver.name },
        );
      }
      seen.set(quiver.name, quiver.name);
    }

    this.#quivers = Object.freeze([...args.quivers]);
  }

  /**
   * Resolves a selector ref → canonical ref (e.g. "memo" → "memo@1.1.0").
   *
   * Applies multi-quiver precedence (§4): scan quivers in order, first quiver
   * with any matching candidate wins, highest match within that quiver returned.
   *
   * Throws:
   *   - `invalid_ref` if ref fails parseQuillRef
   *   - `quill_not_found` if no quiver has a matching candidate
   */
  async resolve(ref: string): Promise<string> {
    // Throws invalid_ref on malformed input.
    const parsed = parseQuillRef(ref);

    for (const quiver of this.#quivers) {
      const versions = quiver.versionsOf(parsed.name);
      if (versions.length === 0) continue;

      // Filter by selector if present; otherwise all versions are candidates.
      const candidates =
        parsed.selector === undefined
          ? versions
          : versions.filter((v) => matchesSemverSelector(v, parsed.selector!));

      if (candidates.length === 0) continue;

      // First quiver with any candidate wins — pick highest within that quiver.
      const winner = chooseHighestVersion(candidates);
      // chooseHighestVersion returns null only for empty arrays; candidates is non-empty.
      return `${parsed.name}@${winner!}`;
    }

    throw new QuiverError(
      "quill_not_found",
      `No quill found for ref "${ref}" in any registered quiver.`,
      { ref },
    );
  }

  /**
   * Returns a render-ready QuillLike instance for a canonical ref.
   * Materializes via engine.quill(tree) on first call; caches by canonical ref.
   *
   * Throws:
   *   - `invalid_ref` if canonicalRef is not valid canonical x.y.z form
   *   - `quill_not_found` if canonical ref doesn't map to a loaded quiver
   *   - propagates I/O errors from loadTree unchanged
   *   - propagates engine errors from engine.quill() unchanged (not wrapped)
   */
  async getQuill(canonicalRef: string): Promise<QuillLike> {
    // Fast path: already cached.
    const cached = this.#cache.get(canonicalRef);
    if (cached !== undefined) return cached;

    // In-flight dedup: if there's a pending promise, reuse it.
    const existing = this.#inflight.get(canonicalRef);
    if (existing !== undefined) return existing;

    const promise = this.#loadQuill(canonicalRef);
    this.#inflight.set(canonicalRef, promise);

    try {
      const quill = await promise;
      this.#cache.set(canonicalRef, quill);
      return quill;
    } finally {
      // Clear the in-flight entry regardless of success or failure,
      // so retries don't get a poisoned promise.
      this.#inflight.delete(canonicalRef);
    }
  }

  /** Internal: does the actual loading work for getQuill. */
  async #loadQuill(canonicalRef: string): Promise<QuillLike> {
    // Parse and validate canonical form (must be x.y.z).
    const parsed = parseQuillRef(canonicalRef);
    if (parsed.selectorDepth !== 3) {
      throw new QuiverError(
        "invalid_ref",
        `getQuill requires a canonical ref (x.y.z) but received "${canonicalRef}". ` +
          `Use resolve() first to obtain a canonical ref.`,
        { ref: canonicalRef },
      );
    }

    const version = parsed.selector!;

    // Find the first quiver that owns this exact (name, version) pair.
    const owningQuiver = this.#quivers.find((q) =>
      q.versionsOf(parsed.name).includes(version),
    );

    if (owningQuiver === undefined) {
      throw new QuiverError(
        "quill_not_found",
        `Quill "${canonicalRef}" was not found in any registered quiver.`,
        { ref: canonicalRef, version },
      );
    }

    // Load the file tree — I/O errors propagate as-is.
    const tree = await owningQuiver.loadTree(parsed.name, version);

    // Materialize the Quill via the engine.
    // Engine errors propagate unchanged — they are not QuiverErrors and we
    // should not mask them. The caller's error-handling stack will see the
    // engine's own error type directly.
    const quill = this.#engine.quill(tree);

    return quill;
  }

  /**
   * Warms all quill refs across all composed quivers. Fail-fast.
   *
   * Calls loadTree + engine.quill(tree) for every known quill version.
   * Already-cached refs resolve instantly (idempotent).
   */
  async warm(): Promise<void> {
    for (const quiver of this.#quivers) {
      for (const name of quiver.quillNames()) {
        for (const version of quiver.versionsOf(name)) {
          await this.getQuill(`${name}@${version}`);
        }
      }
    }
  }
}
