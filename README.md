# @quillmark/quiver

Load and build collections of quills for rendering with `@quillmark/wasm`.

## Install

```bash
npm install @quillmark/quiver @quillmark/wasm
```

## Distribution model

A Quiver has one authored shape: the **source layout** (`Quiver.yaml` at the
package root, quills under `quills/<name>/<x.y.z>/`). Authors publish it as
an npm package. Consumers decide how to consume it:

- **Node consumers** load the source layout directly with `Quiver.fromPackage`.
- **Browser consumers** run `Quiver.build(...)` as a build step and serve the
  output as static assets, loading it with `Quiver.fromBuilt`.

Each loader names exactly what it loads: `fromPackage` and `fromDir` always
read source layouts; `fromBuilt` always reads build output over HTTP/HTTPS.
No auto-detection, no branching on artifact shape.

This keeps the author flow to a single command (`npm publish` or `git tag`)
and puts the deployment-topology decision where it belongs: with the
consumer.

## Authoring a quiver

Lay out the source per the spec, then publish to npm (or push a git tag):

```
my-quiver/
  Quiver.yaml
  quills/
    <name>/<x.y.z>/
      Quill.yaml
      ...
  package.json
```

Recommended CI: use the bundled `@quillmark/quiver/testing` harness — it
loads with `Quiver.fromDir` and exercises every quill so validation errors
surface on publish, not on the consumer's build. The harness uses
`node:test` (built into Node 18+); no extra test-runner dependency
required. If you prefer vitest/jest/mocha, write a 12-line loop against
the main API instead.

## Consuming a quiver (Node)

```ts
import { Quillmark, Document } from "@quillmark/wasm";
import { Quiver } from "@quillmark/quiver/node";

const engine = new Quillmark();
const quiver = await Quiver.fromPackage("@org/my-quiver");

const doc = Document.fromMarkdown(markdownString);
const quill = await quiver.getQuill(doc.quillRef, { engine });
const result = quill.render(doc, { format: "pdf" });
```

`getQuill` accepts both selector refs (`"memo"`, `"memo@1"`) and canonical
refs (`"memo@1.0.0"`). It resolves the selector, materializes the quill via
`engine.quill(tree)`, and caches per (engine, canonical-ref). Concurrent
calls for the same ref share a single load.

If you only need the canonical ref (without materializing), use `resolve`:

```ts
const canonicalRef = await quiver.resolve("memo"); // "memo@1.1.0"
```

## Consuming a quiver (browser)

Browsers cannot read the source layout directly, so build at deploy time and
serve the output as static files:

```ts
// build script (Node) — typically wired into your existing build pipeline
import { Quiver } from "@quillmark/quiver/node";

await Quiver.build(
  "./node_modules/@org/my-quiver",
  "./public/quivers/my-quiver",
);
```

```ts
// browser runtime
import { Quiver } from "@quillmark/quiver";

const quiver = await Quiver.fromBuilt("/quivers/my-quiver/");
const quill = await quiver.getQuill(doc.quillRef, { engine });
```

## Advanced: pre-built distribution to a CDN

If you need to ship the runtime artifact directly (e.g. consumers cannot run
a Node build step), publish `Quiver.build` output to a CDN and have
consumers point `fromBuilt` at the CDN URL:

```ts
import { Quiver } from "@quillmark/quiver/node";

await Quiver.build("./my-quiver", "./dist/my-quiver");
// upload ./dist/my-quiver to https://cdn.example.com/quivers/my-quiver/
const quiver = await Quiver.fromBuilt("https://cdn.example.com/quivers/my-quiver/");
```

## Warm (prefetch all quill trees)

```ts
await quiver.warm();
```

`warm()` is network-only: it fetches every quill's tree and caches them.
It does not require an engine and does not materialize Quill instances —
that happens lazily on the first `getQuill` call, which is microseconds.
A subsequent `getQuill` reuses the cached tree, skipping the fetch.

## Error handling

All errors are instances of `QuiverError` with a `code` field.

```ts
import { QuiverError } from "@quillmark/quiver";

try {
  await quiver.resolve("unknown_quill");
} catch (err) {
  if (err instanceof QuiverError) {
    console.error(err.code);    // e.g. "quill_not_found"
    console.error(err.message); // human-readable description
    console.error(err.ref);     // offending ref, when available
  }
}
```

Error codes: `invalid_ref`, `quill_not_found`, `quiver_invalid`, `transport_error`.

## Full specification

See [PROGRAM.md](./PROGRAM.md) for the complete API surface, runtime artifact format specification, and design decisions.
