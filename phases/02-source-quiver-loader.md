# Phase 2 — Source Quiver Loader

**Goal:** Implement `Quiver.fromSourceDir()` — the Node-only factory that reads a Source Quiver from disk, validates `Quiver.yaml`, discovers quills under `quills/<name>/<version>/`, and holds the in-memory catalog ready for registry composition.

**Depends on:** Phase 1

---

## Deliverables

### `src/quiver.ts` — `Quiver` class (partial, source-only)

```ts
export class Quiver {
  readonly name: string;

  /**
   * Node-only. Reads a Source Quiver from a directory containing `Quiver.yaml`
   * and `quills/<name>/<version>/Quill.yaml` entries.
   * Throws `quiver_invalid` on schema violations, `transport_error` on I/O failure.
   */
  static async fromSourceDir(path: string): Promise<Quiver>;

  // --- internal surface (not exported from entrypoints) ---

  /** Returns all known quill names. */
  quillNames(): string[];

  /** Returns all canonical versions for a given quill name, sorted descending. */
  versionsOf(name: string): string[];

  /**
   * Loads the file tree for a specific quill version.
   * Returns Map<string, Uint8Array> suitable for engine.quill(tree).
   * Throws `transport_error` on I/O failure.
   */
  loadTree(name: string, version: string): Promise<FileTree>;
}
```

### `src/quiver-yaml.ts` — `Quiver.yaml` parser/validator (internal)

```ts
/**
 * Parses and validates Quiver.yaml contents.
 * Throws `quiver_invalid` on:
 *   - Missing or non-string `name`
 *   - `name` fails charset validation [A-Za-z0-9_-]+
 *   - Unknown fields (strict-by-default)
 *   - YAML parse failure
 */
export function parseQuiverYaml(raw: string | Uint8Array): QuiverMeta;
```

Design notes:
- Use a tiny YAML parser or manual parse. `Quiver.yaml` has only two flat fields (`name`, `description`), so a full YAML library is optional — but acceptable if kept small. Decision: use a lightweight approach (regex/JSON-ish) or add `yaml` as a dependency. (Recommend documenting the choice.)
- Unknown fields → `quiver_invalid` per §2.

### `src/source-loader.ts` — Source directory scanner (internal)

Handles the filesystem walk for Source Quiver layout:

```ts
/**
 * Scans <root>/quills/<name>/<version>/ directories.
 * Validates:
 *   - Each <version> is canonical semver (x.y.z)
 *   - Each version dir contains Quill.yaml
 * Returns a catalog: Map<quillName, sortedVersions[]>.
 * Throws `quiver_invalid` for non-canonical versions.
 * Throws `transport_error` for I/O failures.
 */
export async function scanSourceQuiver(rootDir: string): Promise<{
  meta: QuiverMeta;
  catalog: Map<string, string[]>;
}>;

/**
 * Reads all files under a quill version directory into a FileTree.
 * Throws `transport_error` on I/O failure.
 */
export async function readQuillTree(quillDir: string): Promise<FileTree>;
```

Key differences from prior `FileSystemSource`:
- Returns `Map<string, Uint8Array>` (not the nested engine tree object) — the `Quiver` class is format-agnostic at this layer. Conversion to engine tree happens in the registry/getQuill path.
- Non-canonical version directories are a **validation error** (`quiver_invalid`), not silently skipped.
- No font manifest logic at source layer — fonts are quill-local files like any other asset.

### `src/format.ts` — `toEngineTree` (internal)

Ported from prior `format.ts`. Converts `Map<string, Uint8Array>` to the nested `{ files: { ... } }` shape that `engine.quill(tree)` expects.

```ts
/**
 * Converts a flat file map to the nested tree expected by engine.quill(tree).
 * Text files → string, binary files (by extension) → number[].
 */
export function toEngineTree(files: FileTree): Map<string, Uint8Array>;
```

> **Note:** Verify with current `@quillmark/wasm` JS API — `engine.quill(tree)` takes `Map<string, Uint8Array>` per the reference docs. If the WASM binding truly accepts a flat `Map<string, Uint8Array>` directly, `toEngineTree` may just be a pass-through or only needed for the nested JSON shape used by older `registerQuill`. Confirm and simplify accordingly.

---

## Tests

### Fixtures

Create a minimal Source Quiver fixture under `src/__tests__/fixtures/sample-quiver/`:

```
sample-quiver/
  Quiver.yaml          # name: sample
  quills/
    memo/
      1.0.0/
        Quill.yaml
        template.typ
      1.1.0/
        Quill.yaml
        template.typ
    resume/
      2.0.0/
        Quill.yaml
        template.typ
```

### Test files

| File | Covers |
|---|---|
| `src/__tests__/quiver-yaml.test.ts` | Valid parse; missing name; invalid charset; unknown fields → `quiver_invalid`; optional description |
| `src/__tests__/source-loader.test.ts` | Scan fixture → correct catalog; non-canonical version dir → `quiver_invalid`; missing Quill.yaml → `quiver_invalid`; missing quills/ dir → empty catalog; I/O error → `transport_error` |
| `src/__tests__/quiver.test.ts` | `fromSourceDir` happy path; `quillNames()`; `versionsOf()`; `loadTree()` returns correct `Map<string, Uint8Array>` |

---

## Exports (this phase)

| Entrypoint | Exports |
|---|---|
| `src/index.ts` | `Quiver` (class), `QuiverError` |
| `src/node.ts` | Re-exports everything from `src/index.ts` (Node factories are methods on `Quiver`, not separate exports) |

`fromSourceDir` is a static method on `Quiver` — it works from the `/node` entrypoint. In the main entrypoint, calling it in a browser context should throw `transport_error` (because `node:fs` won't be available). This guard can be deferred to Phase 6, or placed now with a simple runtime check.

---

## Acceptance

```bash
npm test    # all new + existing tests pass
npm run lint
```

---

## Notes

- YAML parsing decision: the simplest compliant path is to add a small YAML dep (e.g., `yaml` npm package) since `Quiver.yaml` and `Quill.yaml` are YAML. Alternatively, since V1 schema is two flat string fields, a regex parser works. Document chosen approach.
- `Quiver` instances are immutable after construction — the catalog is frozen at load time.
- `loadTree()` reads files lazily (on-demand), not eagerly at `fromSourceDir` time.
