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
- `description` (optional)
- `version` (reserved/experimental; optional; no load-bearing responsibilities in V1)

`name` is runtime namespace identity and may differ from npm package name.

`version` is accepted if present but is not consumed by resolution, caching, engine registration, or any other runtime path. It exists only as a reserved field for possible future use (e.g. cross-quiver dependency declarations). Tooling must not rely on it and must not error on its absence. For npm-channel identity, `package.json.version` is authoritative; for packed-artifact identity, the hashed manifest is authoritative.

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

- Engine registration should be idempotent by canonical ref
- Content mismatch on same canonical ref remains an error
- Engine should operate on canonical refs (no selector/name-only ambiguity)

Performance strategy:

- Registry tracks which canonical refs it has already sent across WASM boundary
- Avoid repeated boundary transfers for hot path resolves

This avoids expensive repeated payload crossings while preserving correctness.

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
5. Engine API migration plan for canonical-only/idempotent registration behavior
6. Validation API shape consolidation
7. Pack artifact directory structure and compatibility guarantees
8. Node/browser package entrypoint split for the new package name

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
