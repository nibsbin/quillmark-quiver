# Phase 1 — Core Types & Error Model

**Goal:** Establish `QuiverError`, internal types, `parseQuillRef`, and semver utilities. After this phase, every later module can import a stable error class and ref-parsing primitives.

**Depends on:** Phase 0

---

## Deliverables

### `src/errors.ts` — `QuiverError`

Single error class (no subclasses), per PROGRAM.md §Error Model:

```ts
export type QuiverErrorCode =
  | "invalid_ref"
  | "quill_not_found"
  | "quiver_invalid"
  | "transport_error"
  | "quiver_collision";

export class QuiverError extends Error {
  readonly code: QuiverErrorCode;
  /** Offending ref string, when available. */
  readonly ref?: string;
  /** Offending version, when available. */
  readonly version?: string;
  /** Quiver `name` from Quiver.yaml, when available. */
  readonly quiverName?: string;

  constructor(
    code: QuiverErrorCode,
    message: string,
    options?: {
      ref?: string;
      version?: string;
      quiverName?: string;
      cause?: unknown;
    },
  ) { /* ... */ }
}
```

Design notes:
- Contextual payload fields (`ref`, `version`, `quiverName`) are flat — no nested options bag at read-time.
- `cause` is forwarded to `Error({ cause })` for native chaining.
- Legacy codes (`version_not_found`, `load_error`, `source_unavailable`, `manifest_invalid`, etc.) are deliberately absent — they fold into `quill_not_found`, `quiver_invalid`, or `transport_error`.

### `src/ref.ts` — `parseQuillRef` (internal)

Parses selector strings into a structured internal type. **Not exported** from package entrypoints.

```ts
/** Internal parsed representation of a quill reference. */
export interface ParsedQuillRef {
  name: string;
  /** Undefined = "highest in first-winning quiver". */
  selector?: string;
  /** Selector part count: 1 = `x`, 2 = `x.y`, 3 = `x.y.z` (exact). */
  selectorDepth?: 1 | 2 | 3;
}

/**
 * Throws QuiverError('invalid_ref') on malformed input.
 * Validates name charset: [A-Za-z0-9_-]+
 * Validates selector per §5 (x, x.y, x.y.z — digits only, no ranges/operators).
 */
export function parseQuillRef(ref: string): ParsedQuillRef;
```

### `src/semver.ts` — Semver utilities (internal)

Small, focused helpers. **Not exported.**

```ts
/** Returns true for exactly `x.y.z` with non-negative integer parts. */
export function isCanonicalSemver(version: string): boolean;

/** Returns true if `version` (canonical) matches `selector` (partial). */
export function matchesSemverSelector(version: string, selector: string): boolean;

/** Returns the highest version string, or null if empty. */
export function chooseHighestVersion(versions: string[]): string | null;

/** Compares two canonical semver strings. Returns <0, 0, or >0. */
export function compareSemver(a: string, b: string): number;
```

Ported from existing `registry.ts` — logic is identical, just extracted.

### `src/types.ts` — Shared internal types

```ts
/** In-memory file tree: relative path → raw bytes. */
export type FileTree = Map<string, Uint8Array>;

/** Quiver.yaml parsed shape (V1). */
export interface QuiverMeta {
  name: string;
  description?: string;
}

/** Manifest entry for a single quill inside a packed quiver. */
export interface PackedQuillEntry {
  name: string;
  version: string;
  bundle: string; // e.g. "usaf_memo@1.2.3.def456.zip"
  fonts: Record<string, string>; // path → md5 hash
}

/** Hashed manifest shape (V1). */
export interface PackedManifest {
  version: 1;
  name: string;
  quills: PackedQuillEntry[];
}
```

---

## Tests

| File | Covers |
|---|---|
| `src/__tests__/errors.test.ts` | Construct each code; `instanceof Error`; `cause` chaining; payload fields |
| `src/__tests__/ref.test.ts` | Valid refs (`usaf_memo`, `usaf_memo@1`, `usaf_memo@1.2`, `usaf_memo@1.2.3`); invalid refs (empty, `@`, `foo@^1`, `foo@>=1`, `foo@*`, `foo@1.2.3-beta`, special chars in name) |
| `src/__tests__/semver.test.ts` | `isCanonicalSemver`, `matchesSemverSelector`, `chooseHighestVersion`, `compareSemver` — ported/adapted from existing registry tests |

---

## Acceptance

```bash
npm test   # all new tests pass
npm run lint   # no type errors
```

---

## Notes

- `parseQuillRef` and semver utils are **not** exported from `src/index.ts` or `src/node.ts`. They are internal modules consumed by later phases.
- The `FileTree` type uses `Map<string, Uint8Array>` to align directly with `engine.quill(tree)` which takes a `Map<string, Uint8Array>`.
