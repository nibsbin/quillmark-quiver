# Phase 0 — Project Scaffold

**Goal:** A buildable, testable, empty package with correct dual entrypoints and dependency declarations.

**Why first:** Every subsequent phase needs a working `tsc` + `vitest` loop. Getting the package plumbing right early avoids entrypoint surprises later.

---

## Deliverables

### `package.json`

```jsonc
{
  "name": "@quillmark/quiver",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./node": {
      "types": "./dist/node.d.ts",
      "import": "./dist/node.js"
    }
  },
  "files": ["dist"],
  "peerDependencies": {
    "@quillmark/wasm": ">=0.57.0"
  },
  "dependencies": {
    "fflate": "^0.8.2"
  },
  "devDependencies": {
    "@quillmark/wasm": "^0.57.0",
    "@types/node": "^25.3.3",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  }
}
```

### `tsconfig.json`

- `target`: `ES2022`, `module`: `NodeNext`, `moduleResolution`: `NodeNext`
- `outDir`: `dist`, `rootDir`: `src`, `declaration`: true
- `strict`: true

### Source stubs

| File | Contents |
|---|---|
| `src/index.ts` | Re-exports browser-safe surface (empty for now) |
| `src/node.ts` | Re-exports Node-only surface (empty for now) |

### Test scaffold

| File | Contents |
|---|---|
| `vitest.config.ts` | Minimal config pointing at `src/__tests__/` |
| `src/__tests__/smoke.test.ts` | Single `it('builds', ...)` asserting imports resolve |

---

## Acceptance

```bash
npm install
npm run build   # exits 0
npm test        # exits 0, 1 passing test
```

---

## Notes

- `fflate` is the only runtime dep; it is browser-safe for zip read/write.
- `node:crypto` is used only inside `pack()` (Phase 4) — never imported at the top level of the main entrypoint.
- `@quillmark/wasm` is a **peer dependency** (not bundled).
