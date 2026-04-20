import type { QuillBundle, QuillManifest, QuillSource } from '../types.js';
import { RegistryError } from '../errors.js';
import { toEngineFileTree } from '../format.js';
import { unpackFiles } from '../bundle.js';
import { FONT_MANIFEST_FILE_NAME, parseAndValidateFontManifest } from '../font-manifest.js';

export interface HttpSourceOptions {
	/** Base URL serving zips + manifest (e.g., "https://cdn.example.com/quills/"). */
	baseUrl: string;
	/**
	 * Manifest filename under `baseUrl` (e.g. `manifest.a1b2c3.json` from `packageForHttp()`).
	 * Required unless `manifest` is preloaded.
	 */
	manifestFileName?: string;
	/** Optional pre-loaded manifest to skip the initial fetch (for SSR bootstrap). */
	manifest?: QuillManifest;
	/** Optional custom fetch function (for testing or non-browser environments). */
	fetch?: typeof globalThis.fetch;
}

/**
 * QuillSource that fetches quill zip bundles and manifest from any HTTP endpoint.
 *
 * Supports local static serving, CDN hosting, and remote quill registries
 * with the same interface. Bundle URLs use hashed filenames from the manifest (from `packageForHttp()`).
 */
export class HttpSource implements QuillSource {
	private baseUrl: string;
	private manifestFileName?: string;
	private preloadedManifest?: QuillManifest;
	private cachedManifest?: QuillManifest;
	private fetchFn: typeof globalThis.fetch;
	private fontCache: Map<string, Promise<Uint8Array>> = new Map();

	constructor(options: HttpSourceOptions) {
		// Ensure baseUrl ends with a slash for consistent URL construction
		this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : options.baseUrl + '/';
		this.manifestFileName = options.manifestFileName;
		this.preloadedManifest = options.manifest;
		this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
		if (!this.preloadedManifest && !this.manifestFileName) {
			throw new Error(
				'HttpSource requires `manifestFileName` (from packageForHttp) unless `manifest` is preloaded.',
			);
		}
	}

	async getManifest(): Promise<QuillManifest> {
		if (this.preloadedManifest) {
			return this.preloadedManifest;
		}

		if (this.cachedManifest) {
			return this.cachedManifest;
		}

		const url = `${this.baseUrl}${this.manifestFileName}`;
		let response: Response;
		try {
			response = await this.fetchFn(url);
		} catch (err) {
			throw new RegistryError('source_unavailable', `Failed to fetch manifest from ${url}`, {
				cause: err,
			});
		}

		if (!response.ok) {
			throw new RegistryError(
				'source_unavailable',
				`Failed to fetch manifest: ${response.status} ${response.statusText}`,
			);
		}

		let manifest: QuillManifest;
		try {
			manifest = (await response.json()) as QuillManifest;
		} catch (err) {
			throw new RegistryError('source_unavailable', 'Failed to parse manifest JSON', {
				cause: err,
			});
		}

		this.cachedManifest = manifest;
		return manifest;
	}

	async loadQuill(name: string, version: string): Promise<QuillBundle> {
		const manifest = await this.getManifest();
		const matchingByName = manifest.quills.filter((q) => q.name === name);
		const entry = matchingByName.find((q) => q.version === version);

		if (!entry) {
			if (version && matchingByName.length > 0) {
				throw new RegistryError(
					'version_not_found',
					`Quill "${name}" exists but version "${version}" was not found`,
					{ quillName: name, version },
				);
			}
			throw new RegistryError('quill_not_found', `Quill "${name}" not found in source`, {
				quillName: name,
				version,
			});
		}

		const resolvedVersion = entry.version;
		if (!entry.bundleFileName) {
			throw new RegistryError(
				'load_error',
				`Manifest entry for "${name}@${resolvedVersion}" is missing bundleFileName; re-pack with packageForHttp().`,
				{ quillName: name, version: resolvedVersion },
			);
		}
		const bundleUrl = `${this.baseUrl}${entry.bundleFileName}`;

		let response: Response;
		try {
			response = await this.fetchFn(bundleUrl);
		} catch (err) {
			throw new RegistryError('load_error', `Failed to fetch quill bundle from ${bundleUrl}`, {
				quillName: name,
				version: resolvedVersion,
				cause: err,
			});
		}

		if (!response.ok) {
			throw new RegistryError(
				'load_error',
				`Failed to fetch quill bundle: ${response.status} ${response.statusText}`,
				{ quillName: name, version: resolvedVersion },
			);
		}

		let files: Record<string, Uint8Array>;
		try {
			const zipData = new Uint8Array(await response.arrayBuffer());
			files = await unpackFiles(zipData);
		} catch (err) {
			throw new RegistryError('load_error', `Failed to unpack quill "${name}"`, {
				quillName: name,
				version: resolvedVersion,
				cause: err,
			});
		}
		await this.rehydrateFonts(files);

		return {
			name: entry.name,
			version: resolvedVersion,
			data: toEngineFileTree(files),
			metadata: entry,
		};
	}

	private fetchFont(hash: string): Promise<Uint8Array> {
		const cached = this.fontCache.get(hash);
		if (cached) return cached;
		const storeUrl = `${this.baseUrl}store/${hash}`;
		const promise = (async () => {
			let response: Response;
			try {
				response = await this.fetchFn(storeUrl);
			} catch (cause) {
				throw new RegistryError('load_error', `Failed to fetch font bytes from ${storeUrl}`, { cause });
			}
			if (!response.ok) {
				throw new RegistryError(
					'load_error',
					`Failed to fetch font bytes: ${response.status} ${response.statusText}`,
				);
			}
			return new Uint8Array(await response.arrayBuffer());
		})().catch((err) => {
			this.fontCache.delete(hash);
			throw err;
		});
		this.fontCache.set(hash, promise);
		return promise;
	}

	private async rehydrateFonts(files: Record<string, Uint8Array>): Promise<void> {
		const rawManifest = files[FONT_MANIFEST_FILE_NAME];
		if (!rawManifest) return;

		const manifest = parseAndValidateFontManifest(rawManifest);
		const hashes = [...new Set(Object.values(manifest.files))];
		await Promise.all(hashes.map((hash) => this.fetchFont(hash)));

		for (const [filePath, hash] of Object.entries(manifest.files)) {
			files[filePath] = await this.fontCache.get(hash)!;
		}
		delete files[FONT_MANIFEST_FILE_NAME];
	}
}
