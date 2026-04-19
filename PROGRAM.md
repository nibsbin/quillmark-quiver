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

Minimum fields for V1:

- `name` (required)
- `version` (required; canonical semver `x.y.z` only)
- `description` (optional)

`name` is runtime namespace identity and may differ from npm package name.

### 3) `QuillSource` Becomes Quiver-Centric

- `QuillSource` concepts are re-expressed around Quivers
- Split old filesystem concept into:
  - **Source filesystem loader** (reads Source Quiver directly)
  - **Packed filesystem transport** (loads Packed Quiver artifact from disk)
- `HttpSource` becomes HTTP transport for Packed Quiver, not a separate format concept

### 4) Multi-Quiver Composition with Deterministic Precedence

`QuillRegistry` accepts multiple quivers with explicit order.

Precedence rule (hard decision):

- **Precedence is a hard filter**
- Scan quivers in order
- First quiver with any matching candidate wins
- Then choose highest matching version **within that quiver**

This applies to both:

- unqualified refs (e.g. `usaf_memo`)
- selector refs (e.g. `usaf_memo@1.2`)

No global “highest across all quivers” behavior.

### 5) Semver Selector Rules Are Strict and Small

Supported selector forms only:

- `name@x.y.z` exact
- `name@x.y` highest `x.y.*`
- `name@x` highest `x.*.*`

Not supported in V1:

- ranges (`>=`, `<`, etc.)
- npm operators (`^`, `~`)
- wildcards (`*`)
- prereleases and build metadata

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

### 7) Engine Boundary: Correctness in Engine, Performance in Registry

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
- **Ref-string parsing** (`name@selector`) is library responsibility

Library still needs a single shared ref parser for direct JS API usage (`resolve`, `warm`, validation inputs).

### 9) Distribution Strategy

V1 supports:

- npm distribution for Source Quiver projects
- git/folder-copy consumption of Source Quivers
- `pack()` output for Packed Quiver runtime distribution

Important clarification:

- npm/git are developer distribution channels
- packed artifacts are runtime delivery artifacts

### 10) `package.json` + `Quiver.yaml` Drift Policy (No CLI in V1)

Known risk: duplicated `version` field.

Given **Quiver CLI is out of scope for V1**, enforce drift with validation instead of automation:

- `Quiver.yaml` is runtime source of truth
- packing/publish path must fail if `package.json.version !== Quiver.yaml.version`
- contributor docs must explicitly require updating both together

---

## Carryover Matrix (What We Keep)

V1 intentionally carries these proven behaviors:

1. **Font dehydration**, now defined as a Packed Quiver property (not HTTP-specific)
2. **Consumer validation tooling**, for Source Quivers and optional Packed parity checks
3. **Manifest pointer resolution**, generalized as part of Packed Quiver format
4. **HTTP loading** as a Packed transport
5. **Source filesystem loading** as first-class dev loop
6. **Packed filesystem loading** as a new capability
7. **Typed errors** (`RegistryError`) with expanded quiver/transport codes
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

Retain typed error catalog and add clear V1 codes such as:

- `invalid_ref`
- `quiver_not_found`
- `quiver_invalid`
- `transport_error`
- `manifest_invalid`
- `version_mismatch` (for pack/publish validation paths)

Errors should include offending ref/version/quiver identifiers when available.

---

## Runtime + Packaging Model

V1 runtime supports three loading paths:

1. Source Quiver from filesystem (authoring/dev)
2. Packed Quiver over HTTP (browser/runtime)
3. Packed Quiver from filesystem (air-gapped/container/runtime)

V1 packaging behavior:

- `pack()` produces Packed Quiver artifact independent of transport
- packed output includes pointer + hashed manifest + bundles + dehydrated font store

---

## Out of Scope for V1

- Quiver CLI (`quiver init`, `quiver version`, etc.)
- prerelease semver support
- semver range expression support
- Quiver-declared precedence/priority
- inter-quiver dependency graph in `Quiver.yaml`
- marketplace/discovery service
- advanced warm strategies (hot lists, adaptive prefetch), beyond API-compatible hooks

---

## Planner Questions to Resolve in Implementation Plan

1. Final `Quiver` interface shape and transport factoring style (transport argument vs dedicated classes)
2. Final `Quiver.yaml` schema and unknown-field policy
3. Canonical ref grammar and parser API contract
4. Exact warning policy for shadowed refs across quivers
5. Validation API shape consolidation
6. Pack artifact directory structure and compatibility guarantees
7. Node/browser package entrypoint split for the new package name

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
- V1 ships without CLI dependency while still preventing version drift at pack/publish time
