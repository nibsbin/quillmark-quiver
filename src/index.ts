// Main browser-safe entrypoint.
//
// Exposes only browser-safe surface. Node-only factories
// (`Quiver.fromDir`, `fromPackage`, `build`) and the `BuildOptions` type
// live at `@quillmark/quiver/node`.
export { QuiverError } from "./errors.js";
export type { QuiverErrorCode } from "./errors.js";
export { Quiver } from "./quiver.js";
export type { QuillmarkLike, QuillLike } from "./engine-types.js";
