# Phase 3 — Quiver Registry & Resolution

**Goal:** Implement `QuiverRegistry` — the composition layer that accepts multiple `Quiver` instances, resolves selector refs with deterministic precedence, materializes render-ready `Quill` objects via `engine.quill(tree)`, and caches them in-process.

**Depends on:** Phase 2

---

## Deliverables

### `src/registry.ts` — `QuiverRegistry`

```ts
import type { Quillmark, Quill } from "@quillmark/wasm"; // peer dep types

export class QuiverRegistry {
  constructor(args: { engine: Quillmark; quivers: Quiver[] });

  /**
   * Resolves a selector ref → canonical ref (e.g. "usaf_memo" → "usaf_memo@1.2.3").
   * Applies multi-quiver precedence (§4): scan quivers in order, first with any
   * matching candidate wins, highest match within that quiver.
   *
   * Throws:
   *   - `invalid_ref` if ref fails parseQuillRef
   *   - `quill_not_found` if no quiver has a matching candidate
   */
  resolve(ref: string): Promise<string>;

  /**
   * Returns a render-ready Quill instance for a canonical ref.
   * Materializes via engine.quill(tree) on first call; caches by canonical ref.
   *
   * Throws:
   *   - `invalid_ref` if canonicalRef is not valid canonical form
   *   - `quill_not_found` if canonical ref doesn't map to a loaded quiver
   *   - `transport_error` if file loading fails
   */
  getQuill(canonicalRef: string): Promise<Quill>;

  /**
   * Warms all refs across all composed quivers. Fail-fast.
   * Calls loadTree + engine.quill(tree) for every known quill version.
   */
  warm(): Promise<void>;
}
```

### Resolution algorithm (§4 + §5)

```
resolve(ref):
  1. parsed = parseQuillRef(ref)        // throws invalid_ref
  2. for quiver in quivers (insertion order):
       versions = quiver.versionsOf(parsed.name)
       if no versions → continue to next quiver
       candidates = versions matching parsed.selector (or all versions if no selector)
       if candidates.length > 0:
         winner = chooseHighestVersion(candidates)
         return `${parsed.name}@${winner}`    // canonical ref
  3. throw QuiverError('quill_not_found', ...)
```

Key behaviors:
- **Precedence is a hard filter.** First quiver with *any* candidate wins. No cross-quiver highest.
- Unqualified refs (no `@`) → highest version in first-winning quiver.
- `name@x.y.z` exact → must exist in first-winning quiver.
- `name@x.y` → highest `x.y.*` in first-winning quiver.
- `name@x` → highest `x.*.*` in first-winning quiver.

### `getQuill` flow

```
getQuill(canonicalRef):
  1. if cache has canonicalRef → return cached Quill
  2. parse canonicalRef → { name, version } (must be x.y.z exact)
  3. find which quiver owns name+version
  4. tree = await quiver.loadTree(name, version)
  5. quill = engine.quill(tree)
  6. cache.set(canonicalRef, quill)
  7. return quill
```

### Collision detection (§4)

```ts
constructor({ engine, quivers }):
  // Check for duplicate Quiver.yaml.name across quivers
  const seen = new Map<string, number>();
  for (const [i, q] of quivers.entries()) {
    if (seen.has(q.name)) {
      throw new QuiverError('quiver_collision', ...);
    }
    seen.set(q.name, i);
  }
```

Wait — re-reading §4: "duplicate `Quiver.yaml.name` across composed quivers is an error." But precedence requires *different* quivers to potentially have the *same quill names* (just different quiver identities). The collision check is on **quiver** identity (`Quiver.yaml.name`), not on quill names within quivers.

### Concurrency coalescing (internal)

```ts
// In-flight dedup for getQuill to prevent duplicate engine.quill(tree) calls
private inflight: Map<string, Promise<Quill>> = new Map();
```

Same pattern as prior registry's `this.resolving` / `this.registering` maps.

### `warm()` implementation

```ts
async warm(): Promise<void> {
  const refs: string[] = [];
  for (const quiver of this.quivers) {
    for (const name of quiver.quillNames()) {
      for (const version of quiver.versionsOf(name)) {
        refs.push(`${name}@${version}`);
      }
    }
  }
  // Fail-fast: sequential to surface first error immediately
  for (const ref of refs) {
    await this.getQuill(ref);
  }
}
```

---

## Tests

### Mocking strategy

`engine.quill(tree)` is a peer dep method. Tests should use a lightweight mock:

```ts
const mockEngine = {
  quill(tree: Map<string, Uint8Array>) {
    return { render: vi.fn(), compile: vi.fn() }; // mock Quill
  },
};
```

### Test files

| File | Covers |
|---|---|
| `src/__tests__/registry.test.ts` | See cases below |

**Resolution cases:**
- Single quiver, unqualified ref → highest version
- Single quiver, `name@1` → highest `1.*.*`
- Single quiver, `name@1.2` → highest `1.2.*`
- Single quiver, `name@1.2.3` → exact match
- `name@1.2.3` not found → `quill_not_found`
- Malformed ref → `invalid_ref`

**Multi-quiver precedence:**
- Two quivers both have `memo`; first quiver wins even if second has higher version
- First quiver has no `memo`, second does → second wins
- Neither has `memo` → `quill_not_found`

**Collision:**
- Two quivers with same `Quiver.yaml.name` → `quiver_collision` at construction

**getQuill:**
- Returns a `Quill`-shaped object from mock engine
- Same canonical ref returns cached instance (identity check)
- Invalid canonical ref → error

**warm:**
- Warms all refs; subsequent getQuill calls return cached
- First error aborts (fail-fast)

---

## Exports (this phase)

| Entrypoint | Exports |
|---|---|
| `src/index.ts` | `Quiver`, `QuiverRegistry`, `QuiverError` |

---

## Acceptance

```bash
npm test
npm run lint
```

Full hot-path flow works in tests:
```ts
const quiver = await Quiver.fromSourceDir("fixtures/sample-quiver");
const registry = new QuiverRegistry({ engine: mockEngine, quivers: [quiver] });
const canonicalRef = await registry.resolve("memo");
const quill = await registry.getQuill(canonicalRef);
// quill is the mock Quill object
```

---

## Notes

- `resolve()` is sync-capable in the source-quiver case (catalog is pre-scanned), but kept `async` because packed-quiver resolution may need I/O in Phase 5.
- `getQuill()` is always async because `loadTree()` does I/O.
- Cache eviction is explicitly out of scope for V1 (§Caching scope).
- `ref_mismatch` warning from `quill.render()` is surfaced by upstream — Quiver does not suppress it (§8). No Quiver-level logic needed.
