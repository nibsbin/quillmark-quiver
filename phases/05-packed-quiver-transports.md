# Phase 5 — Packed Quiver Transports

**Goal:** Implement `Quiver.fromPackedDir()` (Node) and `Quiver.fromHttp()` (browser-safe) — the two factories that load a Packed Quiver artifact and expose the same `Quiver` interface used by `QuiverRegistry`.

**Depends on:** Phase 3 (registry consumes Quiver), Phase 4 (pack produces the format these transports consume)

---

## Deliverables

### `Quiver` class additions

```ts
class Quiver {
  // ... existing (Phase 2) ...

  /** Node-only. Loads a Packed Quiver from a local directory. */
  static async fromPackedDir(path: string): Promise<Quiver>;

  /** Browser-safe. Loads a Packed Quiver from an HTTP base URL. */
  static async fromHttp(url: string): Promise<Quiver>;
}
```

Both factories return a `Quiver` instance with the same API surface as `fromSourceDir`:
- `name` (from manifest)
- `quillNames()`
- `versionsOf(name)`
- `loadTree(name, version)` → `FileTree` (rehydrated, ready for `engine.quill(tree)`)

### Internal transport abstraction

Transport stays **internal** — not exported (§Explicit Trims, YAGNI for V1).

```ts
/** Internal interface shared by packed loaders. */
interface PackedTransport {
  /** Fetch raw bytes by relative path within the packed artifact. */
  fetchBytes(relativePath: string): Promise<Uint8Array>;
}
```

Two implementations:

#### `src/transports/fs-transport.ts` (Node-only)

```ts
class FsTransport implements PackedTransport {
  constructor(private rootDir: string) {}
  async fetchBytes(relativePath: string): Promise<Uint8Array> {
    // node:fs/promises readFile
    // Throws transport_error on failure
  }
}
```

#### `src/transports/http-transport.ts` (browser-safe)

```ts
class HttpTransport implements PackedTransport {
  constructor(private baseUrl: string) {}
  async fetchBytes(relativePath: string): Promise<Uint8Array> {
    // globalThis.fetch
    // Throws transport_error on non-2xx, network error
  }
}
```

### `src/packed-loader.ts` — Packed Quiver loading logic (internal)

Shared between both transports:

```ts
/**
 * Loads a Packed Quiver via the given transport.
 * Flow:
 *   1. fetch Quiver.json (pointer)
 *   2. parse pointer → manifest filename
 *   3. fetch manifest.<hash>.json
 *   4. validate manifest (version: 1, name, quills array)
 *   5. build catalog from manifest entries
 *   6. return Quiver instance backed by lazy tree loading
 *
 * loadTree(name, version) flow (called later by registry):
 *   1. find manifest entry for name@version
 *   2. fetch bundle zip → unpack → flat file map
 *   3. rehydrate fonts: for each fonts[path] → hash, fetch store/<hash>
 *   4. merge rehydrated font bytes into file map
 *   5. convert to FileTree (Map<string, Uint8Array>)
 */
export async function loadPackedQuiver(transport: PackedTransport): Promise<Quiver>;
```

### Rehydration algorithm

```
loadTree(name, version):
  entry = manifest.quills.find(q => q.name === name && q.version === version)
  if !entry → throw quill_not_found

  // 1. Fetch + unpack bundle
  zipBytes = await transport.fetchBytes(entry.bundle)
  files = unpackFiles(zipBytes)   // Record<string, Uint8Array>

  // 2. Rehydrate fonts from store
  for (path, hash) of entry.fonts:
    fontBytes = await transport.fetchBytes(`store/${hash}`)
    files[path] = fontBytes

  // 3. Convert to FileTree
  return new Map(Object.entries(files))
```

### Concurrency coalescing

Font fetches should be coalesced (same hash fetched once even if multiple quill loads request it concurrently):

```ts
class PackedQuiverState {
  private fontCache: Map<string, Promise<Uint8Array>> = new Map();

  async fetchFont(transport: PackedTransport, hash: string): Promise<Uint8Array> {
    let promise = this.fontCache.get(hash);
    if (!promise) {
      promise = transport.fetchBytes(`store/${hash}`).catch(err => {
        this.fontCache.delete(hash);
        throw err;
      });
      this.fontCache.set(hash, promise);
    }
    return promise;
  }
}
```

Same pattern as prior `HttpSource.fontCache`.

---

## Pointer resolution

`Quiver.json` is the stable pointer file:

```json
{ "manifest": "manifest.abc123.json" }
```

Validation:
- Must be valid JSON
- Must have `manifest` field as non-empty string
- Unknown fields → `quiver_invalid`

This replaces the prior `resolveManifestFileName` bootstrap → the pointer is a fixed-name file (`Quiver.json`), not a configurable bootstrap URL.

---

## Tests

### Fixtures

Extend the test fixture from Phase 4: pack `sample-quiver` into a `packed-quiver/` fixture directory:

```
packed-quiver/
  Quiver.json
  manifest.<hash>.json
  memo@1.0.0.<hash>.zip
  memo@1.1.0.<hash>.zip
  resume@2.0.0.<hash>.zip
  store/
    <font-hash-1>
    <font-hash-2>
```

For HTTP tests, use a mock fetch or a local HTTP server.

### Test files

| File | Covers |
|---|---|
| `src/__tests__/packed-loader.test.ts` | See cases below |
| `src/__tests__/transports/fs-transport.test.ts` | fetchBytes happy path; missing file → transport_error |
| `src/__tests__/transports/http-transport.test.ts` | fetchBytes happy path (mock fetch); HTTP 404 → transport_error; network error → transport_error |

**Packed loader cases:**

1. **fromPackedDir happy path:** load packed fixture → `quillNames()`, `versionsOf()` correct
2. **fromHttp happy path:** load via mock fetch → same catalog
3. **loadTree rehydration:** `loadTree("memo", "1.0.0")` → returns `FileTree` with fonts rehydrated at correct paths
4. **Font coalescing:** two concurrent `loadTree` calls for quills sharing a font → single `store/<hash>` fetch
5. **Invalid pointer:** `Quiver.json` missing → `transport_error`; malformed JSON → `quiver_invalid`
6. **Invalid manifest:** missing `version` field → `quiver_invalid`; unknown fields → `quiver_invalid`
7. **Missing bundle:** manifest references zip that doesn't exist → `transport_error`
8. **Missing store entry:** manifest references font hash not in store → `transport_error`

### Integration test

End-to-end: pack → fromPackedDir → registry.resolve → registry.getQuill → mock render

```ts
await Quiver.pack("fixtures/sample-quiver", tmpDir);
const packed = await Quiver.fromPackedDir(tmpDir);
const registry = new QuiverRegistry({ engine: mockEngine, quivers: [packed] });
const ref = await registry.resolve("memo");
const quill = await registry.getQuill(ref);
// quill is mock Quill object, constructed with correct tree
```

---

## Exports (this phase)

No new public exports — `fromPackedDir` and `fromHttp` are static methods on the existing `Quiver` class.

Transport internals (`PackedTransport`, `FsTransport`, `HttpTransport`) are **not exported**.

---

## Acceptance

```bash
npm test     # all tests pass including integration
npm run lint
```

---

## Notes

- `fromHttp` takes a plain URL string (e.g., `https://cdn.example.com/quivers/my-quiver/`). It appends `Quiver.json` to discover the pointer. No separate manifest filename parameter — the pointer file handles indirection.
- `fromPackedDir` reads from local filesystem using `node:fs/promises`.
- Both factories are async: they eagerly load the pointer + manifest at construction time, but defer bundle/font loading to `loadTree()`.
- The `Quiver` class internally stores either a source-loader or a packed-loader — polymorphism via composition, not inheritance.
