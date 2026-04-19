# Quillmark Engine: Quiver Support Tasking

**Audience:** Quillmark engine maintainer
**Consumer:** `@quillmark/quiver` (registry rewrite; successor to `@quillmark/registry`)
**Design source:** `PROGRAM.md §7, §8` in `nibsbin/quillmark-quiver`

## Background

Quiver composes multiple versioned quill sources and resolves selector refs (`name@x.y`, bare `name`) to canonical refs (`name@x.y.z`) against its own manifest before calling the engine. On hot paths it may re-enter `registerQuill` with the same canonical ref many times per session.

We want the engine boundary to be **correct by canonical ref** and **cheap on repeated entry**. Selector grammar stays in the library — the engine never sees non-canonical refs.

## Tasks

### 1. Idempotent `register_quill` on byte-identical content

Today `register_quill` errors with `RenderError::QuillConfig { "already registered" }` on any duplicate `(name, version)` (see `crates/quillmark/tests/versioning_test.rs::test_version_collision_error`).

**Change:** registering the same canonical ref with byte-identical content returns `Ok` as a no-op. Subsequent calls must be cheap — no rehash, no backend re-init.

### 2. Content-mismatch as a distinct error

Registering the same canonical ref with **differing** content must still error, but with a distinct, machine-matchable code (proposed variant name: `QuillContentMismatch`). Error payload should include the conflicting canonical ref.

### 3. Canonical-only engine boundary

`register_quill`, `get_quill_info`, `render`, and any other ref-consuming APIs operate strictly on canonical `name@x.y.z`.

- Reject selector forms (`@x.y`, `@x`) at the boundary.
- Do not add selector resolution to the engine — the library handles it and only hands canonical refs across.
- If an "unversioned quill = bare name" path exists today, prefer removing it; if kept, document it clearly.

### 4. Cheap existence check

Let the library skip boundary transfers for already-registered canonical refs. Either:

- **(a)** Add `fn has_quill(&self, canonical_ref: &str) -> bool` (wasm: `engine.hasQuill(ref)`), or
- **(b)** Ensure task 1's no-op path is cheap enough that the library can call `register_quill` unconditionally with no measurable cost.

Either is acceptable; (b) may be simpler if the no-op cost is already near zero.

## Out of scope

- Selector grammar / parsing (library owns this)
- Any change to `render` or `parseMarkdown` API shape — the library rewrites `ParsedDocument.quillRef` to canonical (by constructing a new value) before calling `render`. No new render overload is needed.
- Prerelease / build-metadata / semver ranges

## Test updates

In `crates/quillmark/tests/versioning_test.rs`, split `test_version_collision_error` into:

- `test_register_same_canonical_is_noop` — identical content, second call returns `Ok`
- `test_register_same_canonical_content_mismatch` — differing content, errors with the new code

Add a wasm-level test in `crates/bindings/wasm/tests/wasm_bindings.rs` covering (a) `hasQuill` or (b) repeated `registerQuill` idempotence.

## Done when

- Library can call `registerQuill(canonical)` on every render without error or cost concerns.
- A mismatched re-registration surfaces a code distinguishable from other `QuillConfig` failures.
- Engine rejects non-canonical refs at the boundary with a clear diagnostic.
