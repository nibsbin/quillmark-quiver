# Quillmark Feedback — `@quillmark/wasm@0.58.2-rc.6` migration

This file captures feedback from migrating `@quillmark/quiver` to
`@quillmark/wasm@0.58.2-rc.6`.

## Migration experience

**Smooth.** Because Quiver's integration surface with `@quillmark/wasm` is
deliberately narrow — it only calls `engine.quill(tree)` and passes the
resulting `Quill` handle back to consumers — the `ParsedDocument` → `Document`
rename did not reach any Quiver code paths. The changes were limited to:

- `package.json` version bumps (peer + dev).
- Structural type hints in `src/engine-types.ts` (renamed `parsed` → `doc`,
  bumped the verified-against version in the doc comment).
- Documentation: `README.md`, `PROGRAM.md`, `phases/00-project-scaffold.md`,
  `phases/03-registry-and-resolution.md`.

All 213 tests pass, `tsc --noEmit` is clean.

## Blockers

None.

## Migration-guide coverage

The
[WASM migration guide](https://github.com/nibsbin/quillmark/blob/main/prose/migrations/WASM_MIGRATION.md)
is accurate and sufficient for downstream consumers. Every change it
describes is observable in the shipped `wasm.d.ts`:

- `Document` replaces `ParsedDocument` cleanly; no compatibility alias.
- Reserved keys (`BODY`, `CARDS`, `QUILL`) are split into `body`, `cards`, and
  `quillRef` properties as advertised.
- `RenderOptions` no longer has an `assets` field; asset injection via the
  tree passed to `engine.quill(tree)` matches what Quiver already does (its
  `loadTree(name, version)` returns the full `Map<string, Uint8Array>` that
  includes every asset file under the quill directory).

## Nits / suggestions

1. **`Quillmark.quill(tree)` param type is `any`.** The `.d.ts` declares
   `quill(tree: any): Quill`, while the JSDoc says "The tree must be a
   `Map<string, Uint8Array>`." Narrowing the declared type to
   `Map<string, Uint8Array>` (or a discriminated union if other shapes are
   accepted) would let downstream callers catch type mismatches at
   compile-time instead of at runtime. Quiver defines its own
   `QuillmarkLike.quill(tree: Map<string, Uint8Array>)` to recover this.

2. **`Quill.render` / `Quill.open` / `Quill.projectForm` all accept `Document`
   only**, but `insertCard(index, card: any)` and `pushCard(card: any)` take
   `any`. Promoting `card` to a structural `{ tag: string; fields?: object;
   body?: string }` type (matching the existing `Card` interface, perhaps
   named `CardInput`) would make the mutator API self-documenting and let TS
   catch missing-`tag` errors at edit time.

3. **`readonly cards: any` / `readonly frontmatter: any` / `readonly
   warnings: any`.** These getters could be typed as `Card[]`,
   `Record<string, unknown>`, and `Diagnostic[]` respectively. Today
   consumers must re-assert through a cast.

4. **Dist-tag.** `0.58.2-rc.6` is published under the `next` tag while
   `0.58.0` remains `latest`. That is correct, but worth calling out in the
   migration guide: consumers adding the dep via `npm install
   @quillmark/wasm` today still get `0.58.0` (pre-rename). An explicit
   `@quillmark/wasm@next` or `@quillmark/wasm@0.58.2-rc.6` is required to
   reach the `Document`-era API.

5. **`references/quillmark/docs/**`** (vendored into consumer repos like this
   one) still shows the old `ParsedDocument` imports. Not a blocker — these
   are a historical copy — but a heads-up that snapshots in downstream repos
   will need manual refresh.
