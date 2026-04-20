# Phase 4 — Pack

**Goal:** Implement `Quiver.pack(sourceDir, outDir, opts?)` — the Node-only static method that produces a Packed Quiver artifact from a Source Quiver directory.

**Depends on:** Phase 2

---

## Deliverables

### `src/pack.ts` — Pack logic (internal, Node-only)

```ts
export interface PackOptions {
  // Reserved for future use. Empty in V1.
}

/**
 * Reads a Source Quiver, validates it, and writes a Packed Quiver to outDir.
 *
 * Output layout (per §Packed Quiver Format):
 *   outDir/
 *     Quiver.json                         # stable pointer
 *     manifest.<md5>.json                 # hashed manifest
 *     <name>@<version>.<md5>.zip          # one bundle per quill
 *     store/
 *       <md5>                             # dehydrated font bytes
 *
 * Throws:
 *   - `quiver_invalid` on source validation failures
 *   - `transport_error` on I/O failures
 */
export async function packQuiver(
  sourceDir: string,
  outDir: string,
  opts?: PackOptions,
): Promise<void>;
```

### Static method on `Quiver`

```ts
class Quiver {
  // ... existing ...
  static async pack(
    sourceDir: string,
    outDir: string,
    opts?: PackOptions,
  ): Promise<void> {
    return packQuiver(sourceDir, outDir, opts);
  }
}
```

### Pack algorithm

```
packQuiver(sourceDir, outDir):
  1. meta, catalog = scanSourceQuiver(sourceDir)    // reuse Phase 2
  2. clear outDir, create outDir + outDir/store/

  3. manifestQuills = []
  4. for each (name, versions) in catalog:
       for each version in versions:
         a. tree = readQuillTree(quillDir)
         b. separate fonts from non-fonts:
              fonts: files matching /\.(ttf|otf|woff|woff2)$/i
              content: everything else
         c. for each font file:
              hash = md5(bytes)                  // full 32-char hex
              write bytes to store/<hash> (skip if exists)
              record path→hash mapping
         d. zip content files → Uint8Array (deterministic: sorted paths, fixed mtime)
         e. bundleHash = md5Prefix6(zipBytes)
         f. bundleName = `${name}@${version}.${bundleHash}.zip`
         g. write zip to outDir/<bundleName>
         h. append to manifestQuills:
              { name, version, bundle: bundleName, fonts: { path: hash, ... } }

  5. manifest = { version: 1, name: meta.name, quills: manifestQuills }
  6. manifestJson = JSON.stringify(manifest, null, 2)
  7. manifestHash = md5Prefix6(manifestJson)
  8. manifestFileName = `manifest.${manifestHash}.json`
  9. write manifestJson to outDir/<manifestFileName>

  10. pointer = { manifest: manifestFileName }
  11. write JSON.stringify(pointer) to outDir/Quiver.json
```

### `src/bundle.ts` — Zip utilities (internal)

Ported from prior `bundle.ts`, simplified:

```ts
import { zipSync, unzipSync } from "fflate";

const ZIP_EPOCH = new Date(1980, 0, 1);

/** Deterministic zip from a file map. Sorted paths, fixed mtime. */
export function packFiles(files: Record<string, Uint8Array>): Uint8Array;

/** Unpack a zip into a flat file map. */
export function unpackFiles(data: Uint8Array): Record<string, Uint8Array>;
```

### `src/hash.ts` — MD5 helpers (internal, Node-only)

```ts
import { createHash } from "node:crypto";

/** Full MD5 hex digest. */
export function md5(data: Uint8Array | string): string;

/** First 6 hex chars of MD5. */
export function md5Prefix6(data: Uint8Array | string): string;
```

---

## Key design decisions

### Font dehydration

- Fonts are identified by file extension (`ttf`, `otf`, `woff`, `woff2`).
- Font bytes are extracted from quill content and stored in `store/<full-md5-hash>` (extensionless).
- The path→hash mapping goes into the manifest's `fonts` field per quill entry.
- Bundles (zips) contain **no font files** — only `Quill.yaml`, templates, partials, and non-font assets.
- Identical fonts across quills are deduplicated in the store (written once, referenced by hash).

### Differences from prior `packageForHttp()`

| Aspect | Prior (`FileSystemSource`) | New (`pack()`) |
|---|---|---|
| Font mapping | `fonts.json` embedded in zip | `fonts` field in hashed manifest |
| Pointer file | None (manifest filename returned) | `Quiver.json` written to disk |
| Manifest shape | `{ quills: [...] }` | `{ version: 1, name: "...", quills: [...] }` |
| Hash scope | MD5 prefix-6 for bundles + manifest | MD5 prefix-6 for bundles + manifest; full MD5 for font store |
| Font hash format | Full MD5 hex in fonts.json | Full MD5 hex in manifest `fonts` field |

### Bundle contents

Per §Packed Quiver Format: "Bundle zips contain pure quill content (`Quill.yaml` + templates + partials + non-font assets). Fonts are dehydrated at pack time."

No `fonts.json` inside bundles — this is a deliberate departure from the prior format.

---

## Tests

### Test files

| File | Covers |
|---|---|
| `src/__tests__/pack.test.ts` | See cases below |
| `src/__tests__/bundle.test.ts` | `packFiles` → `unpackFiles` roundtrip; deterministic output; sorted paths |
| `src/__tests__/hash.test.ts` | `md5` known vectors; `md5Prefix6` truncation |

**Pack cases (using temp directories + fixture quiver):**

1. **Happy path:** pack sample-quiver → verify output structure:
   - `Quiver.json` exists and contains valid pointer
   - `manifest.<hash>.json` exists, parseable, `version: 1`, correct `name`
   - One `.zip` per quill version
   - `store/` contains expected font hashes (if fixture includes fonts)
   - Zips contain no font files
   - Manifest `fonts` field maps paths to correct hashes

2. **Font deduplication:** two quills share the same font file → single `store/<hash>` entry

3. **Determinism:** packing the same source twice → identical output (same hashes, same filenames)

4. **Invalid source:** non-canonical version dir → `quiver_invalid` propagated from scanner

5. **I/O error:** unwritable outDir → `transport_error`

---

## Exports (this phase)

| Entrypoint | Exports |
|---|---|
| `src/index.ts` | No change (pack is Node-only) |
| `src/node.ts` | `Quiver.pack` available via the `Quiver` class |

`Quiver.pack()` is a static method — it's always present on the class but calls `node:crypto` and `node:fs` internally, so it throws `transport_error` if somehow reached in a browser. (Browser guard finalized in Phase 6.)

---

## Acceptance

```bash
npm test
npm run lint
```

Pack a fixture quiver and verify the output can be read back (prep for Phase 5):
```ts
await Quiver.pack("fixtures/sample-quiver", tmpOutDir);
// verify Quiver.json, manifest, zips, store/ structure
```

---

## Notes

- `node:crypto` is imported only inside `src/hash.ts` and `src/pack.ts` — never from the main entrypoint.
- `PackOptions` is empty in V1 but reserved for future flags (e.g., compression level, include/exclude filters).
- The packed output is self-contained: a consumer needs only the `outDir` contents and a transport (Phase 5) to load quills at runtime.
