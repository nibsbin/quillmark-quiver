# Feedback on `@quillmark/wasm@0.59.0-rc.2`

This document captures notes, blockers, and critical feedback collected while
migrating `@quillmark/quiver` from `@quillmark/wasm@0.58.0` to the
`0.59.0-rc.2` prerelease.

**Migration outcome:** successful. Build + 213 unit/integration tests pass
against the prerelease. Quiver's own hot-path (`engine.quill(tree)` + opaque
`Quill` handle handed back to the caller) is untouched — the breaking surface
is exclusively on the *consumer* side (the code that calls
`Document.fromMarkdown` and `quill.render(doc, opts?)`).

No code blockers were hit. The items below are observations and caveats for
downstream consumers and for the upstream team.

---

## 1) Breaking surface (consumers of `quill.render` / `quill.open`)

`ParsedDocument` (an interface `{ fields, quillRef }`) has been replaced by a
`Document` **class**. Call sites must change:

```diff
- import { Quillmark, ParsedDocument } from "@quillmark/wasm";
- const parsed = ParsedDocument.fromMarkdown(md);
- const result = quill.render(parsed, { format: "pdf" });
+ import { Quillmark, Document } from "@quillmark/wasm";
+ const doc = Document.fromMarkdown(md);
+ const result = quill.render(doc, { format: "pdf" });
```

Notes for the release notes / upgrade guide:

- The export was renamed **and** changed from an interface to a class. A
  blanket find/replace `ParsedDocument` → `Document` is enough for the basic
  call site, but consumers that were structurally typing
  `{ fields, quillRef }` on their own now need an actual `Document` instance.
- `render`'s second arg changed from required (`opts: RenderOptions`) to
  optional (`opts?: RenderOptions | null`). Positive change, but worth
  flagging.
- `Document` carries native resources (`free()` / `[Symbol.dispose]`). The
  previous `ParsedDocument` shape read as plain data. **Downstream code that
  held parsed documents in long-lived caches or passed them across
  async boundaries will need to think about ownership/disposal.** A short
  section in the upgrade notes on `using` / explicit `free()` would help.

---

## 2) `RenderOptions.assets` silently removed

The `assets?: Record<string, Uint8Array | number[]>` field on
`RenderOptions` in 0.58.0 is gone in 0.59.0-rc.2. No replacement is mentioned
in the type file. Callers that were shipping dynamic assets through this
field will fail at type-check time with no migration hint. Please call this
out explicitly in the changelog and document the intended replacement path
(is it now bundled into the tree passed to `engine.quill`? a new API on
`Document`?). Quiver itself doesn't use `assets`, so it is not blocked.

---

## 3) `Quillmark.quill(tree)` type tightened — watch the plain-object path

```ts
// 0.58.0
quill(tree: any): Quill;

// 0.59.0-rc.2
quill(tree: Map<string, Uint8Array>): Quill;
```

The docstring still says "Accepts either a `Map<string, Uint8Array>` or a
plain object (`Record<string, Uint8Array>`)", but the **type** only admits
`Map`. Consumers who were passing `Record<string, Uint8Array>` (supported at
runtime) will now get a compiler error. Please widen the signature to match
the docstring, e.g.:

```ts
quill(tree: Map<string, Uint8Array> | Record<string, Uint8Array>): Quill;
```

Quiver only hands `Map<string, Uint8Array>` instances, so this is not a
blocker for us, but it is a papercut that will be reported by multiple
downstream projects.

---

## 4) Distribution & versioning concerns

- **`dist-tags.latest` is still `0.58.0`.** Users running `npm install
  @quillmark/wasm` continue to land on 0.58.0. That is correct for an
  unstable prerelease, but means *anyone following the README's install
  instructions today* gets the old API, while the README/docs now reference
  the new `Document` shape. Mitigation: ship 0.59.0 as `latest` before
  declaring the migration done at the ecosystem level, or pin consumers to
  the `next` tag explicitly.
- **npm semver + prereleases**: `"@quillmark/wasm": ">=0.57.0"` as a peer
  range does *not* match `0.59.0-rc.2` (prereleases are only matched when
  the `major.minor.patch` matches exactly). We had to bump our peer range to
  `>=0.59.0-rc.2`. Recommend the upstream changelog call out that
  downstream packages need an explicit prerelease-tolerant range during the
  RC window.

---

## 5) Positive observations

- The `Document` class API (`fromMarkdown`, `clone`, `pushCard`, `setField`,
  `setFill`, `toMarkdown`, etc.) is a substantial ergonomics upgrade over
  treating the parsed doc as a plain `{ fields, quillRef }` blob. Round-trip
  safety (`toMarkdown()` → `fromMarkdown()` producing an equal doc) is a
  great guarantee to call out prominently.
- `quill.metadata` and `quill.backendId` being readable on the Quill handle
  are very welcome — several planned Quiver features (surfacing declared
  `supportedFormats`, diagnostics that say which backend drove a render)
  were previously blocked on reaching into the tree ourselves.
- `quill.projectForm(doc)` looks useful for UI-side form binding. Once the
  shape stabilizes, Quiver can consider a thin pass-through helper.
- The `RenderOptions` param on `render` / `open` being optional is a small
  but welcome ergonomic fix.

---

## 6) Impact on `@quillmark/quiver` (this migration)

**Changed files:**

- `package.json` — `devDependencies["@quillmark/wasm"]` pinned to
  `0.59.0-rc.2`; `peerDependencies["@quillmark/wasm"]` bumped to
  `>=0.59.0-rc.2` (see §4 for why `>=0.57.0` stops matching).
- `src/engine-types.ts` — param name on `QuillLike.render` /
  `QuillLike.open` updated from `parsed` to `doc`; docstring updated.
  Structural shape unchanged (`unknown` first arg), so test doubles and
  real engine both still satisfy it.
- `README.md`, `PROGRAM.md` — usage examples updated from
  `ParsedDocument.fromMarkdown` / `parsed.quillRef` to
  `Document.fromMarkdown` / `doc.quillRef`; peer-dep line in PROGRAM.md
  bumped to `>=0.59.0-rc.2`.

**Unchanged (confirmed):**

- `QuiverRegistry` / `Quiver` logic. Quiver never constructs `Document` or
  calls `render`; it only calls `engine.quill(tree)` and returns an opaque
  handle.
- All 213 existing tests (14 files) pass unchanged against the new wasm.
- A smoke test that constructs `new Quillmark()` from 0.59.0-rc.2 and
  passes it to `new QuiverRegistry({ engine, quivers: [] })` succeeds —
  the real class still structurally satisfies `QuillmarkLike`.

**No code blockers encountered.**
