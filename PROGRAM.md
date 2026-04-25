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

### 1) One Authored Shape; A Build Output Derived From It

There is one user-facing shape: the **Source Quiver**.

- Human-authored, git-friendly
- Root `Quiver.yaml`
- Quills under `quills/<name>/<version>/Quill.yaml`
- Assets in normal source layout

A build step (`Quiver.build`) derives a **runtime artifact** from the source.
This artifact is not a peer "format" — it is the source layout's `dist/`
output, optimized for runtime delivery (hashed manifest, per-quill bundle
zips, dehydrated shared font store, stable pointer file). Authors do not
version it, publish it, or check it into git. Consumers do not need to know
its internal shape; loaders accept it transparently alongside source layouts.

Loaders take a path, URL, or npm specifier — there is no separate "transport"
axis. `Quiver.fromDir` and `Quiver.fromUrl` auto-detect whether the target is
a source layout (root `Quiver.yaml`) or a built artifact (root `Quiver.json`
pointer).

**Naming decision:** the verb is `build()`. The runtime artifact has no
proper-noun name; describe it in prose as "the built quiver" or "build
output". This avoids collision with `npm pack`, JS bundler vocabulary, and
the internal "bundle zips" term used inside the runtime artifact.

### 2) `Quiver.yaml` Is Required in Source Quivers

Source Quivers require root `Quiver.yaml` metadata.

Fields for V1:

- `name` (required) — runtime namespace identity; may differ from npm package name. Charset: alphanumeric only (`[A-Za-z0-9_-]+`).
- `description` (optional) — tooling-only metadata in V1; not consumed by runtime paths.

Unknown fields in `Quiver.yaml` are a **validation error** (`quiver_invalid`). Strict-by-default keeps forward compatibility explicit: any future field is additive and requires a schema bump.

`package.json.version` remains npm-channel identity; packed artifact identity remains hashed-manifest based.

### 3) `QuillSource` Becomes Quiver-Centric

- Re-express `QuillSource` concepts around Quivers
- Loaders are organized by **where the quiver lives**, not by what shape
  it is in:
  - `Quiver.fromPackage(specifier)` — npm specifier resolved against
    `node_modules` (Node only)
  - `Quiver.fromDir(path)` — local directory; auto-detects source layout
    (root `Quiver.yaml`) vs build output (root `Quiver.json` pointer)
  - `Quiver.fromUrl(url)` — fetched over HTTP/file URL; auto-detects same
    way as `fromDir`
- "Transport" is not a first-class concept; it is implementation detail of
  `fromUrl`/`fromDir`

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

Warm means "load/prepare quills and materialize render-ready instances",
not "register in engine". There is no engine registration step anymore.
Warm semantics are identical for source-loaded and built-output-loaded
quivers; the loader hides the difference.

### 7) Engine Boundary: New Canonical Contract (Node / JS–WASM only)

Quillmark integration for `@quillmark/quiver` is:

1. Initialize engine once (`new Quillmark()` from `@quillmark/wasm`)
2. When quill bytes are ready, build a render-ready quill with `engine.quill(tree)` (`Map<string, Uint8Array>`)
3. Render through the returned quill: `quill.render(doc, opts?)` (`Document` — built via `Document.fromMarkdown(...)`)

Important implications:

- No engine quill registry in the JS binding; no `registerQuill`, `hasQuill`, or engine-level `render(doc)` in Quiver’s flow
- Quiver owns mapping from canonical ref → in-memory tree → `Quill` instance
- Cache optimization is in-process reuse of `Quill` instances, not registration checks
- Path-based loading (`quill_from_path`) exists in **other** bindings only; in Node, Quiver reads files and assembles `tree` for `engine.quill(tree)` (see upstream `references/quillmark/docs/integration/javascript/api.md`)

For advanced dynamic-asset behavior, defer to Quillmark’s JS/WASM docs; the default integration path here is `engine.quill` + `quill.render`.

### 8) Markdown and Ref Parsing Boundary

- Markdown parsing does not require a quill registry: `Document.fromMarkdown(markdown)`
- Quiver owns ref parsing and selector resolution for its own API (`resolve`, `warm`, validation)
- QUILL field is informational at render time; Quiver routes to the intended quill explicitly without mutating the parsed document in V1

Upstream behavior note:

- If rendering a parsed document whose `quill_ref` differs from selected quill name, render proceeds with warning `quill::ref_mismatch`
- Quiver should surface that warning, not suppress it. In V1, this is an intentional loud footgun detector for ref/selection drift.

### 9) Distribution Strategy

**Source-first distribution.** The published artifact is the **Source
Quiver** — an npm package whose root contains `Quiver.yaml`. Consumers
choose how to consume it:

- **Node consumers** load the source layout directly:
  ```ts
  const quiver = await Quiver.fromPackage("@org/my-quiver");
  ```
- **Browser consumers** run a build step against the resolved source dir
  and serve the output as static assets:
  ```ts
  await Quiver.build("./node_modules/@org/my-quiver", "./public/quivers/my-quiver");
  // browser:
  const quiver = await Quiver.fromUrl("/quivers/my-quiver/");
  ```

Rationale:

- Author release pipeline is `npm publish` (or `git tag`). No second
  artifact, no CDN, no hash bookkeeping outside the npm tarball.
- Deployment topology is the consumer's concern, not the author's.
- The runtime artifact is a build output of the source, not a peer
  distribution shape (see §1).

**Pre-built distribution is supported but not the default.** Authors who
need to ship a runtime-ready artifact directly (e.g. their consumers
cannot run a Node build step) may publish `Quiver.build(...)` output for
loading via `fromDir` or `fromUrl`. Treated as the exception.

Validation responsibility shifts left: authors should run
`Quiver.fromDir` and `Quiver.build` in CI so `quiver_invalid` errors
surface on publish, not on the consumer's build. The bundled
`@quillmark/quiver/testing` harness covers this.

---

## Carryover Matrix (What We Keep)

V1 intentionally retains:

1. Font dehydration as a build-output property
2. Consumer validation tooling for source layouts (+ optional build-parity checks)
3. Manifest pointer resolution for build output
4. HTTP loading via `Quiver.fromUrl`
5. Source layout loading as first-class dev loop (`fromPackage` / `fromDir`)
6. Build-output loading as first-class runtime option (`fromDir` / `fromUrl`)
7. Typed errors (`QuiverError`) with quiver/source context
8. Concurrency coalescing for in-flight loads
9. Preload/fail-fast helpers where they still add value

Removed from carryover assumptions:

- Any engine-registration cache fast path (`register`/`has`) because upstream removed the capability
- "Transport" as a user-facing concept (folded into `fromUrl`/`fromDir` implementation)

---

## Explicit Trims (Surface Reduction)

V1 should trim public API where behavior can stay internal:

- Drop internal-only utility exports
- Keep engine payload and loader internals opaque
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

## Runtime + Build Model

V1 runtime loading paths (the loader auto-detects source vs build output
in each case):

1. `Quiver.fromPackage(specifier)` — npm package resolution (authoring/dev/Node runtime)
2. `Quiver.fromDir(path)` — local directory (any layout)
3. `Quiver.fromUrl(url)` — fetched (browser runtime; also works in Node)

V1 build behavior:

- `Quiver.build(srcDir, outDir)` produces the runtime artifact from a
  source layout
- output includes pointer + hashed manifest + bundles + dehydrated font store
  (see "Runtime Artifact Format" below)

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

## Runtime Artifact Format (normative)

Produced by `Quiver.build()`. Authors do not author this layout; consumers
do not need to inspect it. It is an implementation detail of build output,
specified here only because loaders must agree on its shape.

```
<root>/
  Quiver.json                              # stable pointer, always this filename
  manifest.<md5>.json                      # hashed manifest, content-addressed
  <name>@<version>.<md5>.zip               # one bundle per quill, content-addressed
  store/
    <md5>                                  # raw font bytes, no extension
```

**Hash:** MD5 prefix-6, computed with `node:crypto` at `build()` time only (dev/tooling; not browser runtime).

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

**Bundle zips** contain pure quill content (`Quill.yaml` + templates + partials + non-font assets). Fonts are dehydrated at build time: their bytes live only in `store/<md5>`; their path→hash mapping lives only in the hashed manifest. Bundles do **not** embed a `fonts.json`.

Rehydration on load: the loader fetches the pointer → hashed manifest → required bundle(s) → required `store/<md5>` blobs; library reconstructs the full in-memory tree and builds a render-ready quill via `engine.quill(tree)`.

## API Surface (V1)

Single class, three loaders + one builder. Loaders are organized by where
the quiver lives, not by what shape it is in; `fromDir` and `fromUrl`
auto-detect source layout (root `Quiver.yaml`) vs build output (root
`Quiver.json`).

```ts
class Quiver {
  // Node-only loader: resolve npm specifier against node_modules and load
  // the source layout at the package root. (From `@quillmark/quiver/node`.)
  static fromPackage(specifier: string): Promise<Quiver>;

  // Node-only loader: any local directory. Auto-detects source vs build
  // output. (From `@quillmark/quiver/node`.)
  static fromDir(path: string): Promise<Quiver>;

  // Browser-safe loader: fetch over HTTP/file URL. Auto-detects source vs
  // build output. (From `@quillmark/quiver` main.)
  static fromUrl(url: string): Promise<Quiver>;

  // Node-only tooling: produce the runtime artifact from a source layout.
  // (From `@quillmark/quiver/node`.)
  static build(sourceDir: string, outDir: string, opts?: BuildOptions): Promise<void>;

  readonly name: string; // from Quiver.yaml
  readonly kind: "source" | "built"; // diagnostic; loaders set this

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

**No render wrapper.** Callers invoke `quill.render(doc, opts?)` (and `quill.open(doc)` when needed) after `resolve()` + `getQuill()`. Quiver never mirrors Quillmark render APIs.

**Internal (not exported):** `QuiverManifest` (runtime shape), `parseQuillRef`, in-flight coalescing state, source-vs-built layout detection.

Hot-path flow:
```ts
const doc = Document.fromMarkdown(md);
const canonicalRef = await registry.resolve(doc.quillRef);
const quill = await registry.getQuill(canonicalRef);
const result = quill.render(doc, { format: "pdf" });
```

## Package Structure

**Name:** `@quillmark/quiver`

**Entrypoints:**
- `@quillmark/quiver` (main, browser-safe): `Quiver` class with only
  `fromUrl` functional (Node-only loaders/builder throw `transport_error`
  if reached in browser), `QuiverRegistry`, `QuiverError`, shared types.
- `@quillmark/quiver/node`: adds `Quiver.fromPackage`, `Quiver.fromDir`,
  `Quiver.build` behaviors. Single `Quiver` class — Node-only factories
  fail fast outside Node.

**Dependencies:**
- Peer: `@quillmark/wasm@>=0.59.0-rc.2` with `Quillmark`, `Document.fromMarkdown`, `engine.quill(tree)`, and `quill.render(doc, opts?)` APIs.
- Runtime: `fflate ^0.8.2` for zip read/write (Node + browser)
- Dev-only: `node:crypto` (MD5 hashing in `build()` — never reached at runtime)

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

1. ~~Final `Quiver` interface shape and transport factoring style~~ → Single `Quiver` class, three loaders (`fromPackage`, `fromDir`, `fromUrl`) + one builder (`build`). Source-vs-built detection is internal (YAGNI for separate loaders).
2. ~~Final `Quiver.yaml` schema and unknown-field policy~~ → See §2: alphanumeric `name` and optional tooling-only `description`. Unknown fields are `quiver_invalid`.
3. ~~Canonical ref grammar and parser API contract~~ → Internal `parseQuillRef`, not exported. Selector syntax per §5. Throws `invalid_ref`.
4. ~~Exact warning policy for shadowed refs across quivers~~ → No warnings in V1. Precedence is a hard filter (§4); duplicate quiver names error as `quiver_collision`.
5. ~~Validation API shape consolidation~~ → No separate validation API. Validation errors surface as `QuiverError('quiver_invalid')` during load or `build()`.
6. ~~Build output directory structure~~ → See "Runtime Artifact Format (normative)".
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
- A built artifact can be loaded via URL or local directory with equivalent semantics
- Source-vs-built layout detection is invisible to the consumer at the loader API
- Multi-quiver resolution is deterministic and matches precedence hard-filter rules
- Selector behavior is predictable and explicitly documented
- Quiver (Node) integrates via `engine.quill(tree)` + `quill.render(...)` only (no engine quill registration path)
- Public API surface is smaller and clearer than `@quillmark/registry`
