# @quillmark/registry

**Under Development**

Unified API for discovering, loading, and registering Quills with the Quillmark WASM engine.

**Runtime boundary**

- **`@quillmark/registry`** — Browser-safe entry: no `node:*` imports. Use `HttpSource`, `QuillRegistry`, `validateQuills({ source, ... })`, etc.
- **`@quillmark/registry/node`** — Node-only: `FileSystemSource`, `validateQuillsFromDir({ quillsDir, ... })`, and the same `validateQuills` re-export for convenience.

## Install

```bash
npm install @quillmark/registry
```

**Peer dependency:** Requires `@quillmark/wasm@>=0.54.0` — you provide the engine instance.

## Quick Start

### Browser (HTTP source)

```ts
import { Quillmark, init } from '@quillmark/wasm';
import { QuillRegistry, HttpSource, resolveManifestFileName } from '@quillmark/registry';

// Resolve hashed manifest from a stable pointer file (defaults to manifest.json).
const manifestFileName = await resolveManifestFileName({
  baseUrl: 'https://cdn.example.com/quills/',
});
const source = new HttpSource({
  baseUrl: 'https://cdn.example.com/quills/',
  manifestFileName,
});
const registry = new QuillRegistry({ source });

// Start fetching while @quillmark/wasm initializes
const fetched = registry.fetch('usaf_memo@1.0.0');
init();
const engine = new Quillmark();
registry.setEngine(engine);
await fetched;

// Resolve a quill — fetches, caches, and registers with the engine
const bundle = await registry.resolve('usaf_memo'); // or await registry.resolve('usaf_memo@1.0.0')

// Engine is now ready to render
const parsed = Quillmark.parseMarkdown(myMarkdown);
const result = engine.render(parsed, { quill: 'usaf_memo' });
```

### Node.js (filesystem source)

```ts
import { Quillmark } from '@quillmark/wasm';
import { QuillRegistry } from '@quillmark/registry';
import { FileSystemSource } from '@quillmark/registry/node';

const engine = new Quillmark();
const source = new FileSystemSource('/path/to/quills');
const registry = new QuillRegistry({ source, engine });

const bundle = await registry.resolve('usaf_memo');
```

## API

### `QuillRegistry`

Orchestrates sources, resolves versions, caches loaded quills, and registers them with the engine. Loading is lazy — quills are fetched on first `resolve()` call, not at construction time.

```ts
const registry = new QuillRegistry({ source, engine });
```

| Method | Description |
|---|---|
| `fetch(canonicalRef)` | Fetches a quill bundle by canonical ref (`name@version`, full semver) and caches it. Does not register with the engine. |
| `resolve(ref)` | Resolves a quill reference (`name`, `name@version`, or semver selector like `name@1` / `name@1.2`). Reuses fetched bundles when present, otherwise fetches on demand, then registers with the engine. Returns a `QuillBundle`. |
| `setEngine(engine)` | Attaches or replaces the engine used by `resolve()`. Useful when fetching before `@quillmark/wasm` initialization completes. |
| `getManifest()` | Returns the full `QuillManifest` from the source. |
| `getAvailableQuills()` | Returns `QuillMetadata[]` for all quills in the source. |
| `isLoaded(name)` | Returns `true` if the quill is registered in the engine. |

### `HttpSource`

Fetches quill zips and manifest from any HTTP endpoint. Works in browser and Node.js.

```ts
const source = new HttpSource({
  baseUrl: 'https://cdn.example.com/quills/',
  manifestFileName: 'manifest.a1b2c3.json', // required unless `manifest` is preloaded
  manifest: preloadedManifest, // optional — skip initial manifest fetch (useful for SSR)
  fetch: customFetch,          // optional — custom fetch function
});
```

The manifest and each quill bundle use **content-hashed filenames** (6 hex chars, MD5 prefix) so you can serve them with long-lived CDN caches. Bundle URLs are `{baseUrl}{bundleFileName}` as given in the manifest (no query-string cache buster).

When bundles contain `fonts.json`, `HttpSource` rehydrates stripped font files by fetching raw bytes from `{baseUrl}store/{md5}` and caching them in-memory per `HttpSource` instance.

### `resolveManifestFileName`

Resolves the current hashed manifest filename using a stable bootstrap pointer file.

```ts
import { resolveManifestFileName } from '@quillmark/registry';

const manifestFileName = await resolveManifestFileName({
  baseUrl: 'https://cdn.example.com/quills/',
  // optional: bootstrapFileName defaults to "manifest.json"
  // bootstrapFileName: 'latest-manifest.json',
});
```

Supported pointer payloads:
- plain text: `manifest.a1b2c3.json`
- JSON object: `{ "manifestFileName": "manifest.a1b2c3.json" }`

### `FileSystemSource`

Node.js-only source that reads quill directories from disk. Import from **`@quillmark/registry/node`**. Each version directory must contain a `Quill.yaml` file; name and version are derived from the directory structure.

```ts
import { FileSystemSource } from '@quillmark/registry/node';

const source = new FileSystemSource('/path/to/quills');
```

### `validateQuills` / `validateQuillsFromDir`

- **`validateQuills`** (root) — takes a `QuillSource` (e.g. `HttpSource` in the browser).
- **`validateQuillsFromDir`** (`@quillmark/registry/node`) — convenience for CI: validates all quills under a local directory via `FileSystemSource`.

```ts
import { validateQuills, HttpSource } from '@quillmark/registry';
// or: import { validateQuillsFromDir } from '@quillmark/registry/node';
```

#### Packaging for static hosting

```ts
const { manifestFileName } = await source.packageForHttp('/path/to/output');
// Clears the output directory, then writes:
// - manifest.{hash6}.json
// - name@version.{hash6}.zip per quill
// - store/{md5} for dehydrated font bytes
// Each zip includes fonts.json at root and strips *.ttf/*.otf/*.woff/*.woff2 payloads.
// Pass `manifestFileName` into HttpSource (or publish it alongside your static assets).
```

### `QuillSource` interface

Implement this to create custom sources:

```ts
interface QuillSource {
  getManifest(): Promise<QuillManifest>;
  loadQuill(name: string, version: string): Promise<QuillBundle>;
}
```

## Error Handling

All errors are thrown as `RegistryError` with a typed `code`:

| Code | Meaning |
|---|---|
| `quill_not_found` | No quill with that name exists in the source |
| `version_not_found` | Quill exists but the requested version doesn't |
| `load_error` | Source failed to fetch or parse quill data |
| `source_unavailable` | Network failure, filesystem error, etc. |

```ts
import { RegistryError } from '@quillmark/registry';

try {
  await registry.resolve('nonexistent');
} catch (err) {
  if (err instanceof RegistryError) {
    console.error(err.code, err.quillName);
  }
}
```

## Version Resolution

`fetch()` requires a canonical ref (`name@version`) using full semver (for example, `usaf_memo@1.0.0`). `resolve()` accepts `name`, canonical `name@version`, or semver selectors with missing segments (for example, `usaf_memo@1` or `usaf_memo@1.2`) and picks the highest matching version from a manifest that is loaded eagerly when the registry is constructed. Fetches are deduplicated in-memory to prevent duplicate source loads under races.

When you need a canonical ref for caching, deduping, or telemetry, derive it from the resolved bundle:

```ts
const bundle = await registry.resolve('usaf_memo@1');
const canonicalRef = `${bundle.name}@${bundle.version}`;
```

## License

Apache-2.0
