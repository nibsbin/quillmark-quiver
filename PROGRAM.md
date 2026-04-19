# Program: Quivers Rewrite (`@quillmark/quiver`)

**Status:** Decisions captured for implementation planning  
**Audience:** Senior engineer planning and executing V1  
**Scope:** Rewrite `@quillmark/registry` into `@quillmark/quiver` with cleaner architecture and smaller public surface

## Summary

V1 introduces Quivers as the primary runtime abstraction while preserving proven behavior from `@quillmark/registry` and removing API bloat. The central design shift is:

- **Quiver shape is separate from transport**
- **Source Quiver and Packed Quiver are distinct, first-class formats**
- **HTTP is one transport for Packed Quivers, not the format itself**

This enables npm and filesystem authoring workflows, keeps browser delivery optimized, and adds a new capability: loading packed artifacts directly from local disk without HTTP.

---

## Core Decisions

### 1) Quiver Shapes and Transports Are Orthogonal

Two on-disk/data shapes:

- **Source Quiver** (authoring shape)
  - Human-authored, git-friendly
  - Root `Quiver.yaml`
  - Quills under `quills/<name>/<version>/Quill.yaml`
  - Assets in normal source layout
- **Packed Quiver** (distribution/runtime artifact)
  - Hashed manifest
  - Bundle zips
  - Dehydrated shared font store (`store/<md5>`)
  - Stable pointer file to current hashed manifest

Transport is a separate axis for **Packed Quiver** loading:

- `http` (current browser-style behavior)
- `fs` (new: packed artifact loaded from local disk)
- future transports can be added without changing packed format

**Naming decision:** rename `packageForHttp()` to **`pack()`** (or equivalent) to reflect format, not transport.

### 2) `Quiver.yaml` Is Required in Source Quivers

Source Quivers require a root `Quiver.yaml` as runtime metadata source of truth.

Fields for V1:

- `name` (required) — runtime namespace identity; may differ from npm package name. Charset: alphanumeric only (`[A-Za-z0-9_-]+`).
- `description` (optional) — tooling-only metadata in V1; not consumed by runtime paths.
- `version` (optional, reserved/experimental) — if present, must be canonical `x.y.z` (validated at load time); otherwise loader errors with `quiver_invalid`. Not consumed by resolution, caching, engine registration, or any other runtime path in V1.

Unknown fields in `Quiver.yaml` are a **validation error** (`quiver_invalid`). Strict-by-default keeps forward compatibility explicit: any future field is additive and requires a schema bump.

`version` exists only as a reserved field for possible future use (e.g. cross-quiver dependency declarations). Tooling must not rely on it and must not error on its absence. For npm-channel identity, `package.json.version` is authoritative; for packed-artifact identity, the hashed manifest is authoritative.

### 3) `QuillSource` Becomes Quiver-Centric

- `QuillSource` concepts are re-expressed around Quivers
- Split old filesystem concept into:
  - **Source filesystem loader** (reads Source Quiver directly)
  - **Packed filesystem transport** (loads Packed Quiver artifact from disk)
- `HttpSource` becomes HTTP transport for Packed Quiver, not a separate format concept

### 4) Multi-Quiver Composition with Deterministic Precedence

`QuiverRegistry` accepts multiple quivers with explicit order.

Precedence rule (hard decision):

- **Precedence is a hard filter**
- Scan quivers in order
- First quiver with any matching candidate wins
- Then choose highest matching version **within that quiver**

This applies to both:

- unqualified refs (e.g. `usaf_memo`)
- selector refs (e.g. `usaf_memo@1.2`)

No global "highest across all quivers" behavior.

**Quiver identity collision:** if two composed quivers share the same `Quiver.yaml.name`, registry construction errors in V1. Nuanced collision handling (warnings, shadowing, merging) is deferred to V2.

### 5) Semver Selector Rules Are Strict and Small

Supported selector forms only:

- `name` bare — highest version in the first-winning quiver (per §4 precedence)
- `name@x.y.z` exact
- `name@x.y` highest `x.y.*`
- `name@x` highest `x.*.*`

Not supported in V1:

- ranges (`>=`, `<`, etc.)
- npm operators (`^`, `~`)
- wildcards (`*`)
- prereleases and build metadata

Canonical version format (opinionated, applies throughout Quiver usage):

- Canonical form is `x.y.z` — no prereleases, no build metadata, no ranges
- Binds both `Quiver.yaml.version` and individual quill version directories (`quills/<name>/<version>/`)
- Non-canonical versions on disk are a validation error

Canonicalization rule:

- Resolve selector to canonical version once from manifest snapshot
- All internal caches keyed by canonical ref only

### 6) Prefetch/Warm Moves to Quiver Layer

Registry no longer exposes pre-engine bootstrap patterns.

Quiver owns warm-up:

- `warm()` warms everything by default in V1
- Signature should allow future selectivity and cancellation:
  - `warm(refs?: string[], opts?: { signal?: AbortSignal })`
- `resolve()` must still work for never-warmed refs (warm is optimization, not precondition)

This keeps engine lifecycle and transport lifecycle decoupled and allows parallel `engine init + quiver warm`.

### 7) Engine Boundary: Canonical Hot Path

Design target for wasm boundary:

- Engine registration is idempotent by canonical ref
  - Re-registering the same canonical ref (`name@x.y.z`) is a no-op success
  - Content-mismatch detection is **deferred** for V1: first-write-wins, no hashing. Tightening this later (error on divergent content for the same canonical ref) is additive and non-breaking.
- Engine exposes a cheap existence check: `has_quill(canonical_ref) -> bool` (wasm: `engine.hasQuill(ref)`), so the library can skip boundary transfers on the hot path.
- The engine **remains selector-capable** for standalone consumers. Quiver does not rely on that capability; it resolves selectors library-side and passes canonical refs across the boundary as its own convention. This is *not* engine-enforced — the engine continues to accept selector refs from markdown and resolve them against registered quills, so non-quiver WASM consumers are unaffected.

Render API stays unchanged. Selector-to-canonical rewriting happens library-side:

1. `parseMarkdown` returns the raw author ref verbatim
2. Library resolves selector → canonical against the quiver manifest
3. Library constructs a new `ParsedDocument` with `quillRef` set to the canonical ref (original parse result is not mutated)
4. Library ensures the canonical ref is registered (idempotent), then calls the existing `render`

This trades a minor semantic shift (`ParsedDocument.quillRef` carries the canonical ref at render time, not the author's literal string) for zero growth in engine render surface. The original author ref is preserved on the pre-resolve object for debugging/logging.

Performance strategy:

- Registry tracks which canonical refs it has already sent across WASM boundary (via `hasQuill` or its own in-process cache)
- Avoid repeated boundary transfers for hot path resolves

Dev-mode note: first-write-wins means hot-reloading edited content under an unchanged canonical ref will silently serve the original bytes. For V1, authors should bump the version during iteration; explicit `unregister` / `reload` can be added later without breaking the V1 contract.

### 8) Ref Parsing Boundary

- **Markdown parsing is engine responsibility**
- **Ref-string parsing** (`name@selector`) is a library responsibility for quiver's own API (`resolve`, `warm`, validation). The engine retains its own ref parser for markdown; quiver does not depend on it.

### 9) Distribution Strategy

V1 supports:

- npm distribution for Source Quiver projects
- git/folder-copy consumption of Source Quivers
- `pack()` output for Packed Quiver runtime distribution

Important clarification:

- npm/git are developer distribution channels
- packed artifacts are runtime delivery artifacts

### 10) No Canonical Quiver Version in V1

`Quiver.yaml.version` is reserved/experimental with no load-bearing responsibilities (see decision #2). Because nothing in V1 consumes a quiver-level version, there is no canonical Quiver version and therefore no drift to police between `Quiver.yaml` and `package.json`.

Consequences:

- No pack/publish-time version equality check
- No `version_mismatch` error path tied to quiver-level versioning
- `package.json.version` is authoritative for the npm channel
- Packed-artifact identity is the hashed manifest, not a YAML field

If a future feature requires a canonical quiver version (e.g. cross-quiver dependencies), the field and associated validation policy can be promoted then.

---

## Carryover Matrix (What We Keep)

V1 intentionally carries these proven behaviors:

1. **Font dehydration**, now defined as a Packed Quiver property (not HTTP-specific)
2. **Consumer validation tooling**, for Source Quivers and optional Packed parity checks
3. **Manifest pointer resolution**, generalized as part of Packed Quiver format
4. **HTTP loading** as a Packed transport
5. **Source filesystem loading** as first-class dev loop
6. **Packed filesystem loading** as a new capability
7. **Typed errors** (`QuiverError`, renamed from `RegistryError`) with expanded quiver/transport codes
8. **Concurrency coalescing** for in-flight loads
9. **Engine cache fast path**
10. **Preload/fail-fast helpers** where still useful

---

## Explicit Trims (Surface Reduction)

V1 should aggressively trim public API surface where behavior can stay internal:

- Drop internal-only utility exports (e.g. unknown-error formatter helpers)
- Keep engine payload shape opaque; avoid exposing transport internals
- Consolidate fragmented validation type exports
- Avoid duplicate entry points that expose same validation workflow
- Keep internal cache-mechanism details out of public docs

Net: preserve operational capability, reduce conceptual overhead.

---

## Error Model

Single `QuiverError` class with `code: string` + contextual payload (ref, version, quiver name, underlying cause where applicable). No subclasses. Fail-fast: operations throw on first failure; no aggregate/partial-success results in V1.

V1 code catalog (closed set):

| Code | Fires when |
|---|---|
| `invalid_ref` | Malformed ref string at `resolve()`/`warm()`/`prepare()` boundary (fails `parseQuillRef`) |
| `quill_not_found` | Selector did not match any quill in any composed quiver |
| `quiver_invalid` | `Quiver.yaml` or hashed manifest malformed, unknown field, non-canonical version on disk, or font/bundle hash mismatch |
| `transport_error` | I/O failure: missing path, HTTP non-2xx, network error, permission error. Wraps underlying cause. |
| `quiver_collision` | Two composed quivers share `Quiver.yaml.name` at registry construction |

Dropped vs earlier drafts: `quiver_not_found` folded into `transport_error` (missing path / 404 is transport); `manifest_invalid` folded into `quiver_invalid` (same conceptual class, different file).

Errors must include offending ref/version/quiver identifiers when available.

---

## Runtime + Packaging Model

V1 runtime supports three loading paths:

1. Source Quiver from filesystem (authoring/dev)
2. Packed Quiver over HTTP (browser/runtime)
3. Packed Quiver from filesystem (air-gapped/container/runtime)

V1 packaging behavior:

- `Quiver.pack()` produces Packed Quiver artifact independent of transport
- packed output includes pointer + hashed manifest + bundles + dehydrated font store

---

## Source Quiver Layout (normative)

```
<root>/
  Quiver.yaml
  quills/
    <name>/
      <version>/           # canonical x.y.z
        Quill.yaml
        ...                # quill-local templates, partials, assets, fonts
```

- All assets (including fonts) are **quill-local**. No quiver-level shared asset directory in V1.
- Non-canonical version directories are a validation error (`quiver_invalid`).
- Dedup of identical fonts across quills happens at pack time (into `store/<md5>`), not at the source layer.

## Packed Quiver Format (normative)

```
<root>/
  Quiver.json                              # stable pointer, always this filename
  manifest.<md5>.json                      # hashed manifest, content-addressed
  <name>@<version>.<md5>.zip               # one bundle per quill, content-addressed
  store/
    <md5>                                  # raw font bytes, no extension
```

**Hash:** MD5 prefix-6, computed with `node:crypto` at `pack()` time only (dev/tooling; not browser runtime).

**Pointer** `Quiver.json`:
```json
{ "manifest": "manifest.abc123.json" }
```

**Hashed manifest** `manifest.<md5>.json`:
```json
{
  "version": 1,
  "name": "<quiver-name>",
  "quills": [
    {
      "name": "usaf_memo",
      "version": "1.2.3",
      "bundle": "usaf_memo@1.2.3.def456.zip",
      "fonts": { "fonts/roboto.ttf": "md5abc", "fonts/arial.ttf": "md5def" }
    }
  ]
}
```

**Bundle zips** contain pure quill content (`Quill.yaml` + templates + partials + non-font assets). Fonts are dehydrated at pack time: their bytes live only in `store/<md5>`; their path→hash mapping lives only in the hashed manifest. Bundles do **not** embed a `fonts.json`.

Rehydration on load: transport fetches the pointer → hashed manifest → required bundle(s) → required `store/<md5>` blobs; library reconstructs the full quill tree (`Quill.fromTree`) with font paths pointing at rehydrated bytes.

## API Surface (V1)

Single class, three factories:

```ts
class Quiver {
  // Node-only factories (from `@quillmark/quiver/node`). Fail fast in browser.
  static fromSourceDir(path: string): Promise<Quiver>;
  static fromPackedDir(path: string): Promise<Quiver>;
  // Browser-safe factory (from `@quillmark/quiver` main).
  static fromHttp(url: string): Promise<Quiver>;
  // Node-only tooling. Writes a Packed Quiver to outDir.
  static pack(sourceDir: string, outDir: string, opts?: PackOptions): Promise<void>;

  readonly name: string; // from Quiver.yaml
}
```

```ts
class QuiverRegistry {
  constructor(args: { engine: Quillmark; quivers: Quiver[] });

  // Selector → canonical. Registers into engine as a side effect. Throws invalid_ref / quill_not_found.
  resolve(ref: string): Promise<string>;

  // Rewrites ParsedDocument.quillRef to canonical; ensures registered via engine.hasQuill short-circuit
  // then engine.registerQuill (idempotent in wasm@0.56.0). Returns a NEW ParsedDocument; original is untouched.
  prepare(parsed: ParsedDocument): Promise<ParsedDocument>;

  // Warms every ref in every composed quiver. Fail-fast. Zero params in V1.
  warm(): Promise<void>;
}

class QuiverError extends Error {
  code: "invalid_ref" | "quill_not_found" | "quiver_invalid" | "transport_error" | "quiver_collision";
  // plus contextual payload fields
}
```

**No render wrapper.** Callers invoke `engine.render(ready, opts)`, `engine.dryRun(md)`, `engine.getQuillInfo(name)` directly after `prepare()`/`resolve()`. Quiver never mirrors engine APIs.

**Internal (not exported):** `QuiverTransport`, `QuiverManifest` (runtime shape), `parseQuillRef`, in-flight coalescing state.

Hot-path flow:
```ts
const parsed = Quillmark.parseMarkdown(md);
const ready = await registry.prepare(parsed);
const result = engine.render(ready, { format: "pdf" });
```

## Package Structure

**Name:** `@quillmark/quiver`

**Entrypoints:**
- `@quillmark/quiver` (main, browser-safe): `Quiver` class with only `fromHttp` functional (Node-only factories/pack throw `transport_error` if reached in browser), `QuiverRegistry`, `QuiverError`, shared types.
- `@quillmark/quiver/node`: adds `Quiver.fromSourceDir`, `Quiver.fromPackedDir`, `Quiver.pack` behaviors. Single `Quiver` class — Node-only factories fail fast outside Node.

**Dependencies:**
- Peer: `@quillmark/wasm ^0.56.0` (requires `hasQuill` + idempotent `registerQuill` per `ENGINE_TASKING.md`)
- Runtime: `fflate ^0.8.2` for zip read/write (Node + browser)
- Dev-only: `node:crypto` (MD5 hashing in `pack()` — never reached at runtime)

---

## Out of Scope for V1

- Quiver CLI (`quiver init`, `quiver version`, etc.)
- prerelease semver support
- semver range expression support
- Quiver-declared precedence/priority
- inter-quiver dependency graph in `Quiver.yaml`
- marketplace/discovery service
- advanced warm strategies (hot lists, adaptive prefetch), beyond API-compatible hooks
- multi-quiver name collision resolution (V1 errors on duplicate `Quiver.yaml.name`; warnings/shadowing/merging deferred)

---

## Planner Questions — Resolved

All V1 planner questions resolved; implementation plan can proceed against the spec above.

1. ~~Final `Quiver` interface shape and transport factoring style~~ → Single `Quiver` class, three static factories (`fromHttp`, `fromSourceDir`, `fromPackedDir`). Transport kept internal (no `fromTransport` in V1; YAGNI).
2. ~~Final `Quiver.yaml` schema and unknown-field policy~~ → See §2: alphanumeric `name`, optional `description` (tooling-only), optional `version` (canonical `x.y.z` if present). Unknown fields are `quiver_invalid`.
3. ~~Canonical ref grammar and parser API contract~~ → Internal `parseQuillRef`, not exported. Selector syntax per §5. Throws `invalid_ref`.
4. ~~Exact warning policy for shadowed refs across quivers~~ → No warnings in V1. Precedence is a hard filter (§4); duplicate quiver names error as `quiver_collision`.
5. ~~Validation API shape consolidation~~ → No separate validation API. Validation errors surface as `QuiverError('quiver_invalid')` during load or `pack()`.
6. ~~Pack artifact directory structure~~ → See "Packed Quiver Format (normative)".
7. ~~Node/browser entrypoint split~~ → See "Package Structure": main + `/node` subpath, single `Quiver` class.
8. ~~Final exported type names~~ → `Quiver`, `QuiverRegistry`, `QuiverError`. Hot-path entry is `QuiverRegistry.prepare(parsed)`.

---

## References

Local copies in this repo for implementation and engine contract work:

- **`references/quillmark-registry/`** — `@quillmark/registry` source (current registry, sources, packing, validation patterns to carry over or replace).
- **`references/quillmark/docs`** — Quillmark engine documentation (WASM API, registration, rendering).

---

## Success Criteria

- A team can author and validate a Source Quiver locally with fast filesystem loops
- A packed artifact can be loaded via HTTP or local filesystem with the same semantics
- Multi-quiver resolution is deterministic and matches precedence-hard-filter rules
- Selector behavior is predictable and explicitly documented
- Existing operational capabilities are preserved while public API surface is smaller and clearer
- V1 ships without CLI dependency; no canonical quiver-level version means no drift surface to police
