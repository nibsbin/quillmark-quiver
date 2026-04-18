import { RegistryError } from './errors.js';

export const FONT_MANIFEST_FILE_NAME = 'fonts.json';
export const FONT_MANIFEST_VERSION = 1;

const FONT_EXTENSION_RE = /\.(ttf|otf|woff|woff2)$/i;
const MD5_HEX_RE = /^[a-f0-9]{32}$/;

export interface FontManifest {
	version: 1;
	files: Record<string, string>;
}

export function isFontPath(filePath: string): boolean {
	return FONT_EXTENSION_RE.test(filePath);
}

export function parseAndValidateFontManifest(raw: Uint8Array): FontManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(raw));
	} catch (cause) {
		throw new RegistryError('load_error', 'Failed to parse fonts.json', { cause });
	}
	return validateFontManifest(parsed, 'load_error');
}

export function validateFontManifest(
	manifest: unknown,
	errorCode: 'load_error' | 'source_unavailable' = 'load_error',
): FontManifest {
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		throw new RegistryError(errorCode, 'Invalid fonts.json: expected object');
	}

	const maybeManifest = manifest as { version?: unknown; files?: unknown };

	const unknownKeys = Object.keys(maybeManifest).filter((k) => k !== 'version' && k !== 'files');
	if (unknownKeys.length > 0) {
		throw new RegistryError(errorCode, `Invalid fonts.json: unexpected keys: ${unknownKeys.join(', ')}`);
	}

	if (maybeManifest.version !== FONT_MANIFEST_VERSION) {
		throw new RegistryError(
			errorCode,
			`Invalid fonts.json: version must be ${FONT_MANIFEST_VERSION}`,
		);
	}

	if (!maybeManifest.files || typeof maybeManifest.files !== 'object' || Array.isArray(maybeManifest.files)) {
		throw new RegistryError(errorCode, 'Invalid fonts.json: files must be an object');
	}

	const files: Record<string, string> = {};
	for (const [filePath, hash] of Object.entries(maybeManifest.files)) {
		if (!filePath) {
			throw new RegistryError(errorCode, 'Invalid fonts.json: file paths must be non-empty');
		}
		if (typeof hash !== 'string' || !MD5_HEX_RE.test(hash)) {
			throw new RegistryError(
				errorCode,
				`Invalid fonts.json: "${filePath}" must map to a lowercase md5 hex hash`,
			);
		}
		files[filePath] = hash;
	}

	return {
		version: FONT_MANIFEST_VERSION,
		files,
	};
}
