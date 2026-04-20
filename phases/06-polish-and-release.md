# Phase 6 — Polish & Release Prep

**Goal:** Finalize entrypoint splits, add browser guards, trim public API surface, verify the full contract against PROGRAM.md success criteria, and prepare for npm publish.

**Depends on:** All previous phases

---

## Deliverables

### 1. Entrypoint finalization

#### `src/index.ts` (main, browser-safe)

```ts
// Public API
export { Quiver } from "./quiver.js";
export { QuiverRegistry } from "./registry.js";
export { QuiverError } from "./errors.js";
export type { QuiverErrorCode } from "./errors.js";
export type { PackOptions } from "./pack.js";
```

#### `src/node.ts` (Node-only)

```ts
// Re-export everything from main
export * from "./index.js";
// Node-only factories are methods on Quiver — no separate exports needed.
// This entrypoint simply ensures Node-specific module side-effects
// (like fs/crypto availability) are assumed.
```

### 2. Browser guards

Node-only methods (`fromSourceDir`, `fromPackedDir`, `pack`) must fail fast when called outside Node:

```ts
function assertNode(method: string): void {
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new QuiverError(
      "transport_error",
      `${method} is only available in Node.js`,
    );
  }
}
```

Called at the top of each Node-only factory.

### 3. API surface audit

Verify against PROGRAM.md §API Surface and §Explicit Trims:

| Symbol | Exported? | Notes |
|---|---|---|
| `Quiver` | ✅ main | Class with `fromHttp`, `fromSourceDir`, `fromPackedDir`, `pack`, `name` |
| `QuiverRegistry` | ✅ main | `resolve()`, `getQuill()`, `warm()` |
| `QuiverError` | ✅ main | Single class, `code` + payload fields |
| `QuiverErrorCode` | ✅ main | Type only |
| `PackOptions` | ✅ main | Type only (empty in V1) |
| `PackedTransport` | ❌ | Internal |
| `PackedManifest` | ❌ | Internal |
| `parseQuillRef` | ❌ | Internal |
| `toEngineTree` | ❌ | Internal |
| `FileTree` | ❌ | Internal |
| `QuiverMeta` | ❌ | Internal |
| Semver utilities | ❌ | Internal |
| `packFiles`/`unpackFiles` | ❌ | Internal |

### 4. Package.json finalization

- Verify `exports` map is correct for both entrypoints
- Verify `files` includes only `dist/`
- Verify `peerDependencies` lists `@quillmark/wasm`
- Verify `dependencies` lists `fflate`
- Add `description`, `keywords`, `repository`, `license` fields
- Set `version` to `0.1.0` (or appropriate pre-release)

### 5. README.md

Minimal usage README covering:
- Install
- Quick start (source quiver → registry → resolve → render)
- HTTP / packed dir usage
- Pack command
- Error handling
- Link to PROGRAM.md for full spec

### 6. Final test sweep

Run full test suite and verify all success criteria from PROGRAM.md §Success Criteria:

| Criterion | Verified by |
|---|---|
| Author + validate Source Quiver locally | Phase 2 tests + Phase 4 pack tests |
| Packed artifact loads via HTTP or fs | Phase 5 integration tests |
| Multi-quiver resolution is deterministic | Phase 3 precedence tests |
| Selector behavior is predictable | Phase 3 + Phase 1 ref tests |
| Integration via `engine.quill(tree)` + `quill.render(...)` only | Phase 3 getQuill tests (no registerQuill calls) |
| Public API surface is smaller than `@quillmark/registry` | Phase 6 export audit |

### 7. Build verification

```bash
npm run build           # clean tsc build
npm run lint            # no type errors
npm test                # all tests pass
npm pack --dry-run      # verify package contents
```

---

## Checklist

- [ ] `src/index.ts` exports only: `Quiver`, `QuiverRegistry`, `QuiverError`, `QuiverErrorCode`, `PackOptions`
- [ ] `src/node.ts` re-exports main entrypoint
- [ ] Browser guards on `fromSourceDir`, `fromPackedDir`, `pack`
- [ ] No internal modules leaked in exports
- [ ] `node:crypto` and `node:fs` never imported from `src/index.ts` dependency chain
- [ ] `package.json` `exports` map tested (import from `@quillmark/quiver` and `@quillmark/quiver/node`)
- [ ] `README.md` written
- [ ] All tests pass
- [ ] `npm pack --dry-run` shows clean `dist/` output

---

## Notes

- The main entrypoint (`@quillmark/quiver`) must be browser-safe. This means the `import` chain from `src/index.ts` must never statically import `node:fs` or `node:crypto`. Node-only code must be dynamically imported or isolated behind the `/node` entrypoint.
- If `Quiver` class methods like `fromSourceDir` are defined on the class body, their implementation must use dynamic `import("node:fs/promises")` so the module itself remains loadable in browsers. Alternatively, the class can be defined in `src/quiver.ts` with the Node methods stubbed (throwing browser guard errors), and the `/node` entrypoint patches or extends them. Choose the simpler approach.
- V1 has no CLI — `pack()` is programmatic only.
