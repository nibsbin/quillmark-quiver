# @quillmark/quiver

Quiver registry and packaging for Quillmark — load, compose, and pack collections of quills for rendering with `@quillmark/wasm`.

## Install

```bash
npm install @quillmark/quiver @quillmark/wasm
```

## Quick start

```ts
import { Quillmark, ParsedDocument } from "@quillmark/wasm";
import { Quiver, QuiverRegistry } from "@quillmark/quiver/node";

// 1. Load a source quiver from disk (Node.js only)
const quiver = await Quiver.fromSourceDir("./my-quiver");

// 2. Build a registry with one or more quivers
const engine = new Quillmark();
const registry = new QuiverRegistry({ engine, quivers: [quiver] });

// 3. Resolve a ref, obtain a render-ready quill, and render
const parsed = ParsedDocument.fromMarkdown(markdownString);
const canonicalRef = await registry.resolve(parsed.quillRef);
const quill = await registry.getQuill(canonicalRef);
const result = quill.render(parsed, { format: "pdf" });
```

## HTTP (browser / CDN)

```ts
import { Quiver, QuiverRegistry } from "@quillmark/quiver";

const quiver = await Quiver.fromHttp("https://cdn.example.com/my-quiver");
const registry = new QuiverRegistry({ engine, quivers: [quiver] });
```

## Packed directory (Node.js)

```ts
import { Quiver } from "@quillmark/quiver/node";

const quiver = await Quiver.fromPackedDir("./dist/my-quiver");
```

## Pack a source quiver

```ts
import { Quiver } from "@quillmark/quiver/node";

await Quiver.pack("./my-quiver", "./dist/my-quiver");
```

## Warm (prefetch all quills)

```ts
await registry.warm();
```

## Multi-quiver composition

Quivers are scanned in order. The first quiver with any matching candidate wins;
the highest matching version within that quiver is returned.

```ts
const registry = new QuiverRegistry({
  engine,
  quivers: [primaryQuiver, fallbackQuiver],
});
```

## Error handling

All errors are instances of `QuiverError` with a `code` field.

```ts
import { QuiverError } from "@quillmark/quiver";

try {
  const canonicalRef = await registry.resolve("unknown_quill");
} catch (err) {
  if (err instanceof QuiverError) {
    console.error(err.code);    // e.g. "quill_not_found"
    console.error(err.message); // human-readable description
    console.error(err.ref);     // offending ref, when available
  }
}
```

Error codes: `invalid_ref`, `quill_not_found`, `quiver_invalid`, `transport_error`, `quiver_collision`.

## Full specification

See [PROGRAM.md](./PROGRAM.md) for the complete API surface, packed format specification, and design decisions.
