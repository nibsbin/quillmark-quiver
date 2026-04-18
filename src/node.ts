/**
 * Node-only APIs: local filesystem {@link FileSystemSource} and directory-based validation.
 * The package root (`@quillmark/registry`) stays browser-safe and does not import this module.
 */

export { FileSystemSource } from './sources/file-system-source.js';
export type { FontDehydrationSummary } from './sources/file-system-source.js';

export {
	validateQuills,
	type QuillValidationEngine,
	type ValidateQuillsOptions,
	type QuillValidationEntry,
	type ValidateQuillsResult,
} from './validate.js';

import { FileSystemSource } from './sources/file-system-source.js';
import {
	validateQuills,
	type ValidateQuillsOptions,
	type ValidateQuillsResult,
} from './validate.js';

/** Same as {@link ValidateQuillsOptions} but uses a local `quillsDir` instead of a {@link QuillSource}. */
export type ValidateQuillsFromDirOptions = Omit<ValidateQuillsOptions, 'source'> & {
	/** Path to the quills directory following the `name/version/` layout. */
	quillsDir: string;
};

/**
 * Validates every quill under `quillsDir` using {@link FileSystemSource}.
 * Prefer this on Node/CI; use {@link validateQuills} with {@link HttpSource} in the browser.
 */
export async function validateQuillsFromDir(
	options: ValidateQuillsFromDirOptions,
): Promise<ValidateQuillsResult> {
	const { quillsDir, ...rest } = options;
	return validateQuills({
		...rest,
		source: new FileSystemSource(quillsDir),
	});
}
