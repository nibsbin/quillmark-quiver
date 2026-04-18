import { RegistryError } from './errors.js';

export interface ResolveManifestFileNameOptions {
	/** Base URL serving pointer file + manifest + bundles. */
	baseUrl: string;
	/**
	 * Stable bootstrap pointer filename under `baseUrl`.
	 * Defaults to `manifest.json`.
	 */
	bootstrapFileName?: string;
	/** Optional custom fetch function (for testing or non-browser environments). */
	fetch?: typeof globalThis.fetch;
}

interface ManifestPointerShape {
	manifestFileName?: unknown;
}

function toBaseUrl(baseUrl: string): string {
	return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function parsePointerText(pointerText: string): string {
	const trimmed = pointerText.trim();
	if (!trimmed) {
		throw new Error('Bootstrap pointer is empty');
	}

	// Support a plain-text pointer payload: "manifest.abc123.json"
	if (!trimmed.startsWith('{')) {
		return trimmed;
	}

	// Also support JSON pointer payload: { "manifestFileName": "manifest.abc123.json" }
	let parsed: ManifestPointerShape;
	try {
		parsed = JSON.parse(trimmed) as ManifestPointerShape;
	} catch (err) {
		throw new Error(`Bootstrap pointer JSON is invalid: ${(err as Error).message}`);
	}

	if (typeof parsed.manifestFileName !== 'string' || parsed.manifestFileName.trim() === '') {
		throw new Error('Bootstrap pointer JSON must include a non-empty "manifestFileName" string');
	}

	return parsed.manifestFileName.trim();
}

/**
 * Resolves the current hashed manifest filename via a stable bootstrap pointer.
 *
 * The pointer can be either:
 * - Plain text: `manifest.a1b2c3.json`
 * - JSON object: `{ "manifestFileName": "manifest.a1b2c3.json" }`
 */
export async function resolveManifestFileName(
	options: ResolveManifestFileNameOptions,
): Promise<string> {
	const baseUrl = toBaseUrl(options.baseUrl);
	const bootstrapFileName = options.bootstrapFileName ?? 'manifest.json';
	const url = `${baseUrl}${bootstrapFileName}`;
	const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);

	let response: Response;
	try {
		response = await fetchFn(url);
	} catch (err) {
		throw new RegistryError(
			'source_unavailable',
			`Failed to fetch bootstrap pointer from ${url}`,
			{ cause: err },
		);
	}

	if (!response.ok) {
		throw new RegistryError(
			'source_unavailable',
			`Failed to fetch bootstrap pointer: ${response.status} ${response.statusText}`,
		);
	}

	let pointerText: string;
	try {
		pointerText = await response.text();
	} catch (err) {
		throw new RegistryError('source_unavailable', 'Failed to read bootstrap pointer body', {
			cause: err,
		});
	}

	let manifestFileName: string;
	try {
		manifestFileName = parsePointerText(pointerText);
	} catch (err) {
		throw new RegistryError('source_unavailable', `Invalid bootstrap pointer: ${(err as Error).message}`, {
			cause: err,
		});
	}

	return manifestFileName;
}
