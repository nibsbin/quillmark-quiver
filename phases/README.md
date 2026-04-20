# Implementation Phases — `@quillmark/quiver`

Bite-sized phases for the V1 rewrite. Each phase is self-contained with its own deliverables, tests, and acceptance criteria.

## Dependency Graph

```
Phase 0  Project Scaffold
  │
Phase 1  Core Types & Errors
  │
  ├──────────────────┐
  │                  │
Phase 2              │
Source Quiver        │
Loader               │
  │                  │
  ├──────┐           │
  │      │           │
Phase 3  Phase 4     │
Registry Pack        │
  │      │           │
  │      ├───────────┘
  │      │
Phase 5
Packed Transports
  │
Phase 6
Polish & Release
```

## Phase Summary

| Phase | File | Scope | Key output |
|---|---|---|---|
| 0 | [00-project-scaffold.md](./00-project-scaffold.md) | Package plumbing | Buildable, testable empty package with dual entrypoints |
| 1 | [01-core-types-and-errors.md](./01-core-types-and-errors.md) | Foundation types | `QuiverError`, `parseQuillRef`, semver utilities, `FileTree` |
| 2 | [02-source-quiver-loader.md](./02-source-quiver-loader.md) | Source reading | `Quiver.fromSourceDir()`, `Quiver.yaml` validation, source scanner |
| 3 | [03-registry-and-resolution.md](./03-registry-and-resolution.md) | Composition + resolve | `QuiverRegistry`, multi-quiver precedence, `getQuill()`, `warm()` |
| 4 | [04-pack.md](./04-pack.md) | Packing | `Quiver.pack()`, font dehydration, hashed manifest, bundle zips |
| 5 | [05-packed-quiver-transports.md](./05-packed-quiver-transports.md) | Packed loading | `fromPackedDir()`, `fromHttp()`, rehydration, pointer resolution |
| 6 | [06-polish-and-release.md](./06-polish-and-release.md) | Ship prep | Entrypoint audit, browser guards, API trim, README, build verify |

## Guiding Principles

- **Each phase is independently testable** — it has its own acceptance criteria and test suite.
- **No phase modifies the public API contract retroactively** — the surface grows monotonically.
- **Internal modules stay internal** — transport, manifest, ref parsing, and semver internals are never exported.
- **Errors are always `QuiverError`** with a code from the closed V1 catalog.
