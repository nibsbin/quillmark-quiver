// Types
export type {
	QuillData,
	QuillMetadata,
	QuillManifest,
	QuillBundle,
	QuillSource,
	QuillInfo,
	QuillmarkEngine,
} from './types.js';

// Errors
export { RegistryError } from './errors.js';
export { formatUnknownError } from './errors.js';
export type { RegistryErrorCode } from './errors.js';

// Format utilities
export { toEngineFileTree } from './format.js';

// Sources (browser-safe; Node filesystem: `@quillmark/registry/node`)
export { HttpSource } from './sources/http-source.js';
export type { HttpSourceOptions } from './sources/http-source.js';
export { resolveManifestFileName } from './bootstrap.js';
export type { ResolveManifestFileNameOptions } from './bootstrap.js';

// Registry
export { QuillRegistry } from './registry.js';
export type { QuillRegistryOptions } from './registry.js';

// Validation
export { validateQuills } from './validate.js';
export type {
	QuillValidationEngine,
	ValidateQuillsOptions,
	QuillValidationEntry,
	ValidateQuillsResult,
} from './validate.js';
