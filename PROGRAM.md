# Program: Quivers Rewrite (`@quillmark/quiver`)

**Status:** Updated for upstream Quillmark Render API overhaul  
**Audience:** Senior engineer planning and executing V1  
**Scope:** This document applies only to the **Node/npm** package **`@quillmark/quiver`**: a smaller surface than `@quillmark/registry`, aligned with the **JavaScript/WASM** Quillmark bindings (not Python or other language bindings).

## Summary

V1 still introduces Quivers as the primary runtime abstraction, but one boundary changed materially upstream:

- Quillmark no longer owns a quill registry
- Rendering lives on `Quill` (`quill.render(...)`), not the engine
- Engine is now a backend registry + quill factory (`engine.quill(tree)` on the Quillmark WASM binding, typically `@quillmark/wasm`)

This means Quiver must own quill selection and lifecycle entirely. There is no engine `registerQuill`, `hasQuill`, or engine-level render hot path to optimize around.

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

- `http` (browser/runtime delivery)
- `fs` (packed artifact loaded from local disk)
- future transports can be added without changing packed format

**Naming decision:** use `pack()` (format operation), not transport-specific names.

### 2) `Quiver.yaml` Is Required in Source Quivers

Source Quivers require root `Quiver.yaml` metadata.

Fields for V1:

- `name` (required) — runtime namespace identity; may differ from npm package name. Charset: alphanumeric only (`[A-Za-z0-9_-]+`).
- `description` (optional) — tooling-only metadata in V1; not consumed by runtime paths.

Unknown fields in `Quiver.yaml` are a **validation error** (`quiver_invalid`). Strict-by-default keeps forward compatibility explicit: any future field is additive and requires a schema bump.

`package.json.version` remains npm-channel identity; packed artifact identity remains hashed-manifest based.

### 3) `QuillSource` Becomes Quiver-Centric

- Re-express `QuillSource` concepts around Quivers
- Split old filesystem concept into:
  - **Source filesystem loader** (reads Source Quiver directly)
  - **Packed filesystem transport** (loads Packed Quiver artifact from disk)
- Treat HTTP as a Packed transport, not a separate format concept

### 4) Multi-Quiver Composition with Deterministic Precedence

`QuiverRegistry` accepts multiple quivers with explicit order.

This registry/composition layer lives entirely in `@quillmark/quiver`; it is not a Quillmark engine feature.

Precedence rule:

- **Precedence is a hard filter**
- Scan quivers in order
- First quiver with any matching candidate wins
- Choose highest matching version **within that quiver**

Applies to:

- unqualified refs (e.g. `usaf_memo`)
- selector refs (e.g. `usaf_memo@1.2`)

No global highest-across-all-quivers behavior.

**Identity collision:** duplicate `Quiver.yaml.name` across composed quivers is an error in V1.

### 5) Semver Selector Rules Are Strict and Small

Supported forms:

- `name` (highest version in first-winning quiver)
- `name@x.y.z` exact
- `name@x.y` highest `x.y.*`
- `name@x` highest `x.*.*`

Not supported in V1:

- ranges (`>=`, `<`, etc.)
- npm operators (`^`, `~`)
- wildcards (`*`)
- prerelease/build metadata

Canonical version format:

- `x.y.z` only
- applies to quill version directories (`quills/<name>/<version>/`)
- non-canonical versions on disk are validation errors

Canonicalization:

- resolve selector to canonical ref once per manifest snapshot
- key internal caches by canonical ref

### 6) Warm/Prefetch Is Purely a Quiver Concern

`warm()` remains a quiver-layer optimization:

- `warm()` warms all by default in V1
- `resolve()` must work even if nothing is warmed

Warm now means "load/prepare quills and artifacts", not "register in engine". There is no engine registration step anymore.

### 7) Engine Boundary: New Canonical Contract (Node / JS–WASM only)

Quillmark integration for `@quillmark/quiver` is:

1. Initialize engine once (`new Quillmark()` from `@quillmark/wasm`)
2. When quill bytes are ready, build a render-ready quill with `engine.quill(tree)` (`Map<string, Uint8Array>`)
3. Render through the returned quill: `quill.render(parsed, opts?)` (`ParsedDocument`)

Important implications:

- No engine quill registry in the JS binding; no `registerQuill`, `hasQuill`, or engine-level `render(parsed)` in Quiver’s flow
- Quiver owns mapping from canonical ref → in-memory tree → `Quill` instance
- Cache optimization is in-process reuse of `Quill` instances, not registration checks
- Path-based loading (`quill_from_path`) exists in **other** bindings only; in Node, Quiver reads files and assembles `tree` for `engine.quill(tree)` (see upstream `references/quillmark/docs/integration/javascript/api.md`)

For advanced dynamic-asset behavior, defer to Quillmark’s JS/WASM docs; the default integration path here is `engine.quill` + `quill.render`.

### 8) Markdown and Ref Parsing Boundary

- Markdown parsing does not require a quill registry: `ParsedDocument.fromMarkdown(markdown)`
- Quiver owns ref parsing and selector resolution for its own API (`resolve`, `warm`, validation)
- QUILL field is informational at render time; Quiver routes to the intended quill explicitly without mutating the parsed document in V1

Upstream behavior note:

- If rendering a parsed document whose `quill_ref` differs from selected quill name, render proceeds with warning `quill::ref_mismatch`
- Quiver should surface that warning, not suppress it. In V1, this is an intentional loud footgun detector for ref/selection drift.

### 9) Distribution Strategy

V1 supports:

- npm distribution for Source Quiver projects
- git/folder-copy consumption of Source Quivers
- `pack()` output for Packed runtime distribution

Clarification:

- npm/git are developer distribution channels
- packed artifacts are runtime delivery artifacts

---

## Carryover Matrix (What We Keep)

V1 intentionally retains:

1. Font dehydration as a Packed Quiver property
2. Consumer validation tooling for Source Quivers (+ optional Packed parity checks)
3. Manifest pointer resolution for Packed format
4. HTTP loading as a Packed transport
5. Source filesystem loading as first-class dev loop
6. Packed filesystem loading as first-class runtime option
7. Typed errors (`QuiverError`) with quiver/transport context
8. Concurrency coalescing for in-flight loads
9. Preload/fail-fast helpers where they still add value

Removed from carryover assumptions:

- Any engine-registration cache fast path (`register`/`has`) because upstream removed the capability

---

## Explicit Trims (Surface Reduction)

V1 should trim public API where behavior can stay internal:

- Drop internal-only utility exports
- Keep engine payload and transport internals opaque
- Consolidate validation exports
- Avoid duplicate entry points for equivalent validation workflows
- Do not expose internal quill-object cache mechanisms as public contract

---

## Error Model

Single `QuiverError` class with `code: string` + contextual payload (ref, version, quiver name, underlying cause where applicable). No subclasses. Fail-fast: operations throw on first failure; no aggregate/partial-success results in V1.

V1 code catalog (closed set):

| Code | Fires when |
|---|---|
| `invalid_ref` | Malformed ref string at `resolve()`/`warm()` boundary (fails `parseQuillRef`) |
| `quill_not_found` | Selector did not match any quill in any composed quiver |
| `quiver_invalid` | `Quiver.yaml` or hashed manifest malformed, unknown field, non-canonical version on disk, or font/bundle hash mismatch |
| `transport_error` | I/O failure: missing path, HTTP non-2xx, network error, permission error. Wraps underlying cause. |
| `quiver_collision` | Two composed quivers share `Quiver.yaml.name` at registry construction |

Notes:
- `quill_not_found` is selector-resolution failure after quiver composition and precedence.
- `transport_error` is artifact access failure (filesystem/HTTP/network/permissions), including missing packed files and HTTP 404.
- Legacy categories such as `manifest_invalid`, `quill_load_failed`, and `backend_not_found` are folded into `quiver_invalid` or `transport_error` in V1.

Errors must include offending ref/version/quiver identifiers when available.

---

## Runtime + Packaging Model

V1 runtime loading paths:

1. Source Quiver from filesystem (authoring/dev)
2. Packed Quiver over HTTP (browser/runtime)
3. Packed Quiver from filesystem (air-gapped/container/runtime)

V1 packaging behavior:

- `Quiver.pack()` produces Packed Quiver artifact independent of transport
- packed output includes pointer + hashed manifest + bundles + dehydrated font store

Execution behavior:

- Quiver resolves selector -> canonical ref
- Quiver loads/creates a render-ready `Quill` via engine factory
- Quiver reuses loaded quill objects by canonical ref
- Quiver renders through `quill.render(...)`

Caching scope:

- In V1, loaded-quill object reuse is in scope
- Cache eviction policy is out of scope for V1 (can be added as an additive lifecycle control later)

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

Rehydration on load: transport fetches the pointer → hashed manifest → required bundle(s) → required `store/<md5>` blobs; library reconstructs the full in-memory tree and builds a render-ready quill via `engine.quill(tree)`.

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

  // Read-only introspection and lazy tree access used by QuiverRegistry
  // internally; also available for external debugging and tooling.
  quillNames(): string[];                                              // sorted lex
  versionsOf(name: string): string[];                                  // sorted desc
  loadTree(name: string, version: string): Promise<Map<string, Uint8Array>>;
}
```

```ts
class QuiverRegistry {
  constructor(args: { engine: Quillmark; quivers: Quiver[] });

  // Selector ref -> canonical ref. Throws invalid_ref / quill_not_found.
  resolve(ref: string): Promise<string>;

  // Canonical ref -> render-ready quill handle (materialized via engine.quill(tree), cached in-process).
  getQuill(canonicalRef: string): Promise<Quill>;

  // Warms every ref in every composed quiver. Fail-fast. Zero params in V1.
  warm(): Promise<void>;
}

class QuiverError extends Error {
  code: "invalid_ref" | "quill_not_found" | "quiver_invalid" | "transport_error" | "quiver_collision";
  // plus contextual payload fields
}
```

**No render wrapper.** Callers invoke `quill.render(parsed, opts)` (and `quill.open(parsed)` when needed) after `resolve()` + `getQuill()`. Quiver never mirrors Quillmark render APIs.

**Internal (not exported):** `QuiverTransport`, `QuiverManifest` (runtime shape), `parseQuillRef`, in-flight coalescing state.

Hot-path flow:
```ts
const parsed = ParsedDocument.fromMarkdown(md);
const canonicalRef = await registry.resolve(parsed.quillRef);
const quill = await registry.getQuill(canonicalRef);
const result = quill.render(parsed, { format: "pdf" });
```

## Package Structure

**Name:** `@quillmark/quiver`

**Entrypoints:**
- `@quillmark/quiver` (main, browser-safe): `Quiver` class with only `fromHttp` functional (Node-only factories/pack throw `transport_error` if reached in browser), `QuiverRegistry`, `QuiverError`, shared types.
- `@quillmark/quiver/node`: adds `Quiver.fromSourceDir`, `Quiver.fromPackedDir`, `Quiver.pack` behaviors. Single `Quiver` class — Node-only factories fail fast outside Node.

**Dependencies:**
- Peer: `@quillmark/wasm@>=0.57.0` with `Quillmark`, `ParsedDocument.fromMarkdown`, `engine.quill(tree)`, and `quill.render(parsed, opts)` APIs.
- Runtime: `fflate ^0.8.2` for zip read/write (Node + browser)
- Dev-only: `node:crypto` (MD5 hashing in `pack()` — never reached at runtime)

---

## Out of Scope for V1

- Non-Node consumers of Quillmark (e.g. Python bindings, Rust CLI) as deliverables of this program — `@quillmark/quiver` is the Node/npm package only
- Quiver CLI (`quiver init`, etc.)
- prerelease semver support
- semver range expression support
- quiver-declared precedence/priority
- inter-quiver dependency graph in `Quiver.yaml`
- marketplace/discovery service
- advanced warm strategies beyond API-compatible hooks
- multi-quiver name-collision soft handling (V1 errors on duplicate `Quiver.yaml.name`)

---

## Planner Questions — Resolved

All V1 planner questions resolved; implementation plan can proceed against the spec above.

1. ~~Final `Quiver` interface shape and transport factoring style~~ → Single `Quiver` class, three static factories (`fromHttp`, `fromSourceDir`, `fromPackedDir`). Transport kept internal (no `fromTransport` in V1; YAGNI).
2. ~~Final `Quiver.yaml` schema and unknown-field policy~~ → See §2: alphanumeric `name` and optional tooling-only `description`. Unknown fields are `quiver_invalid`.
3. ~~Canonical ref grammar and parser API contract~~ → Internal `parseQuillRef`, not exported. Selector syntax per §5. Throws `invalid_ref`.
4. ~~Exact warning policy for shadowed refs across quivers~~ → No warnings in V1. Precedence is a hard filter (§4); duplicate quiver names error as `quiver_collision`.
5. ~~Validation API shape consolidation~~ → No separate validation API. Validation errors surface as `QuiverError('quiver_invalid')` during load or `pack()`.
6. ~~Pack artifact directory structure~~ → See "Packed Quiver Format (normative)".
7. ~~Node/browser entrypoint split~~ → See "Package Structure": main + `/node` subpath, single `Quiver` class.
8. ~~Final exported type names~~ → `Quiver`, `QuiverRegistry`, `QuiverError`. Hot-path entry is `QuiverRegistry.resolve(ref)` + `QuiverRegistry.getQuill(canonicalRef)`.

---

## References

Local copies in this repo for `@quillmark/quiver` implementation:

- `references/quillmark-registry/` — prior `@quillmark/registry` source and patterns to mine or replace
- `references/quillmark/docs/integration/javascript/api.md` — JS/WASM API this package integrates with
- `references/quillmark/prose/designs/WASM.md` — WASM binding shape
- `references/quillmark/prose/taskings/quill_render_api.md` — upstream render API overhaul (cross-binding; use the JS/WASM sections for Node)

---

## Success Criteria

- A team can author and validate a Source Quiver locally with fast filesystem loops
- A packed artifact can be loaded via HTTP or local filesystem with equivalent semantics
- Multi-quiver resolution is deterministic and matches precedence hard-filter rules
- Selector behavior is predictable and explicitly documented
- Quiver (Node) integrates via `engine.quill(tree)` + `quill.render(...)` only (no engine quill registration path)
- Public API surface is smaller and clearer than `@quillmark/registry`
