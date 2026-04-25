# @quillmark/quiver

Quiver registry and packaging for Quillmark — load, compose, and pack collections of quills for rendering with `@quillmark/wasm`.

## Install

```bash
npm install @quillmark/quiver @quillmark/wasm
```

## Distribution model

A Quiver is published as its **Source** shape (the human-authored layout in the repo).
Consumers decide how to load it:

- **Node consumers** load the Source Quiver directly with `Quiver.fromSourceDir`.
- **Browser consumers** run `Quiver.pack(...)` as a build step and serve the
  packed output over HTTP with `Quiver.fromHttp`.

This keeps the author flow to a single command (`npm publish` or `git tag`) and
puts the deployment-topology decision where it belongs: with the consumer.

## Authoring a quiver

Lay out a Source Quiver per the spec, then publish to npm (or push a git tag):

```
my-quiver/
  Quiver.yaml
  quills/
    <name>/<x.y.z>/
      Quill.yaml
      ...
  package.json
```

Recommended CI: load with `Quiver.fromSourceDir` and run `Quiver.pack` in a
smoke test so validation errors surface on publish, not on the consumer's build.

## Consuming a quiver (Node)

```ts
import { Quillmark, Document } from "@quillmark/wasm";
import { Quiver, QuiverRegistry } from "@quillmark/quiver/node";

// Resolve the published source quiver from node_modules.
const quiverPath = require.resolve("@org/my-quiver/Quiver.yaml");
const quiver = await Quiver.fromSourceDir(new URL(".", `file://${quiverPath}`).pathname);

const engine = new Quillmark();
const registry = new QuiverRegistry({ engine, quivers: [quiver] });

const doc = Document.fromMarkdown(markdownString);
const canonicalRef = await registry.resolve(doc.quillRef);
const quill = await registry.getQuill(canonicalRef);
const result = quill.render(doc, { format: "pdf" });
```

## Consuming a quiver (browser)

Browsers cannot read the Source Quiver layout directly, so pack at build time
and serve the output as static files:

```ts
// build script (Node)
import { Quiver } from "@quillmark/quiver/node";

await Quiver.pack("./node_modules/@org/my-quiver", "./public/quivers/my-quiver");
```

```ts
// browser runtime
import { Quiver, QuiverRegistry } from "@quillmark/quiver";

const quiver = await Quiver.fromHttp("/quivers/my-quiver");
const registry = new QuiverRegistry({ engine, quivers: [quiver] });
```

## Advanced: pre-packed distribution

If you need to ship a runtime artifact directly (e.g. consumers cannot run a
Node build step), `Quiver.pack` produces a content-addressed Packed Quiver
that can be loaded with `Quiver.fromPackedDir` or `Quiver.fromHttp`:

```ts
import { Quiver } from "@quillmark/quiver/node";

await Quiver.pack("./my-quiver", "./dist/my-quiver");
const quiver = await Quiver.fromPackedDir("./dist/my-quiver");
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
