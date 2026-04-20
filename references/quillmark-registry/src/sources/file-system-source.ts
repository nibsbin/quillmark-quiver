import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { QuillBundle, QuillManifest, QuillMetadata, QuillSource } from '../types.js';
import { RegistryError } from '../errors.js';
import { toEngineFileTree } from '../format.js';
import { packFiles } from '../bundle.js';
import {
	FONT_MANIFEST_FILE_NAME,
	FONT_MANIFEST_VERSION,
	isFontPath,
	validateFontManifest,
} from '../font-manifest.js';

/** Reads files from a directory recursively, returning a map of relative paths to contents. */
async function readDirRecursive(
	dirPath: string,
	basePath: string = dirPath,
): Promise<Record<string, Uint8Array>> {
	const files: Record<string, Uint8Array> = {};
	const entries = await fs.readdir(dirPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		const relativePath = path.relative(basePath, fullPath);

		if (entry.isDirectory()) {
			const subFiles = await readDirRecursive(fullPath, basePath);
			Object.assign(files, subFiles);
		} else if (entry.isFile()) {
			files[relativePath] = new Uint8Array(await fs.readFile(fullPath));
		}
	}

	return files;
}

/** Lists files in a directory recursively, returning relative paths (without reading contents). */
async function listFilesRecursive(
	dirPath: string,
	basePath: string = dirPath,
): Promise<string[]> {
	const paths: string[] = [];
	const entries = await fs.readdir(dirPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);

		if (entry.isDirectory()) {
			paths.push(...(await listFilesRecursive(fullPath, basePath)));
		} else if (entry.isFile()) {
			paths.push(path.relative(basePath, fullPath));
		}
	}

	return paths;
}

/** First 6 lowercase hex chars of MD5 (for cache-busted filenames). */
function md5Prefix6(data: Uint8Array | string): string {
	const hash = createHash('md5');
	if (typeof data === 'string') {
		hash.update(data, 'utf8');
	} else {
		hash.update(data);
	}
	return hash.digest('hex').slice(0, 6);
}

/**
 * Verifies that a Quill.yaml file exists in the given quill directory.
 * Name and version are derived from the directory structure; Quill.yaml
 * content is parsed by the @quillmark/wasm engine at registration time.
 */
async function assertQuillYamlExists(quillDir: string): Promise<void> {
	const yamlPath = path.join(quillDir, 'Quill.yaml');
	try {
		await fs.access(yamlPath);
	} catch {
		throw new RegistryError('load_error', `Missing Quill.yaml in ${quillDir}`);
	}
}

/** Lists subdirectories of a given directory. Filters out dot-prefixed entries. */
async function listSubdirectories(dirPath: string): Promise<string[]> {
	const entries = await fs.readdir(dirPath, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
		.map((e) => e.name);
}

/** Returns true if the string is exactly a three-part semver version (digits and dots only). */
function isSemver(value: string): boolean {
	return /^\d+\.\d+\.\d+$/.test(value);
}

/** Per-font stats returned by {@link FileSystemSource.packageForHttp}. */
export interface FontDehydrationSummary {
	/** Total raw bytes stripped across all quills. */
	strippedBytes: number;
	/** One entry per unique font hash, sorted by hash. */
	fonts: Array<{
		fileName: string;
		hash: string;
		/** Number of quills that contained this font. */
		quillCount: number;
	}>;
}

/**
 * Node.js-only QuillSource that reads Quill directories from the local filesystem.
 *
 * Expects a versioned directory layout:
 *
 * ```
 * quillsDir/
 *   usaf_memo/
 *     0.1.0/
 *       Quill.yaml
 *       template.typ
 *     1.0.0/
 *       Quill.yaml
 *       template.typ
 *   classic_resume/
 *     2.1.0/
 *       Quill.yaml
 *       template.typ
 * ```
 *
 * Each version directory must contain a `Quill.yaml` file. Name and version are
 * derived from the directory structure; Quill.yaml content is validated by the
 * @quillmark/wasm engine at registration time.
 *
 * Also exposes `packageForHttp(outputDir)` to create hashed zip bundles and a hashed
 * manifest JSON file for static hosting (CDN-friendly cache keys).
 */
export class FileSystemSource implements QuillSource {
	private quillsDir: string;

	constructor(quillsDir: string) {
		this.quillsDir = quillsDir;
	}

	async getManifest(): Promise<QuillManifest> {
		let quillNames: string[];
		try {
			quillNames = await listSubdirectories(this.quillsDir);
		} catch (err) {
			throw new RegistryError(
				'source_unavailable',
				`Failed to read quills directory: ${this.quillsDir}`,
				{ cause: err },
			);
		}

		const quills: QuillMetadata[] = [];
		for (const quillName of quillNames) {
			const quillNameDir = path.join(this.quillsDir, quillName);
			let versionDirs: string[];
			try {
				versionDirs = await listSubdirectories(quillNameDir);
			} catch {
				// Skip entries that aren't readable directories
				continue;
			}

			for (const versionDir of versionDirs) {
				if (!isSemver(versionDir)) continue;
				const versionPath = path.join(quillNameDir, versionDir);
				try {
					await assertQuillYamlExists(versionPath);
					quills.push({ name: quillName, version: versionDir });
				} catch (err) {
					if (err instanceof RegistryError) throw err;
					// Skip directories without valid Quill.yaml
				}
			}
		}

		return { quills };
	}

	async loadQuill(name: string, version: string): Promise<QuillBundle> {
		const quillDir = path.join(this.quillsDir, name, version);

		// Verify directory exists
		try {
			await fs.access(quillDir);
		} catch {
			// Check if the quill name exists at all to give a better error
			const nameDir = path.join(this.quillsDir, name);
			try {
				await fs.access(nameDir);
				// Name exists but version doesn't
				throw new RegistryError(
					'version_not_found',
					`Quill "${name}" exists but version "${version}" was not found`,
					{ quillName: name, version },
				);
			} catch (err) {
				if (err instanceof RegistryError) throw err;
				throw new RegistryError('quill_not_found', `Quill "${name}" not found in source`, {
					quillName: name,
					version,
				});
			}
		}

		await assertQuillYamlExists(quillDir);

		const metadata: QuillMetadata = { name, version };

		let files: Record<string, Uint8Array>;
		try {
			files = await readDirRecursive(quillDir);
		} catch (err) {
			throw new RegistryError('load_error', `Failed to read quill directory: ${quillDir}`, {
				quillName: name,
				version,
				cause: err,
			});
		}

		return {
			name,
			version,
			data: toEngineFileTree(files),
			metadata,
		};
	}

	/**
	 * Packages all quills for HTTP static hosting.
	 * Clears `outputDir`, then writes content-addressed `.zip` bundles and
	 * `manifest.{md5prefix6}.json` (hash of the manifest JSON body).
	 *
	 * Returns `manifestFileName` and a `summary` of stripped font bytes.
	 * Callers that want human-readable output can format `summary` themselves.
	 */
	async packageForHttp(outputDir: string): Promise<{ manifestFileName: string; summary: FontDehydrationSummary }> {
		await fs.rm(outputDir, { recursive: true, force: true });
		await fs.mkdir(outputDir, { recursive: true });
		const storeDir = path.join(outputDir, 'store');
		await fs.mkdir(storeDir, { recursive: true });

		const manifest = await this.getManifest();
		const seenRefs = new Set<string>();
		for (const entry of manifest.quills) {
			const ref = `${entry.name}@${entry.version}`;
			if (seenRefs.has(ref)) {
				throw new RegistryError(
					'load_error',
					`Duplicate quill entry "${ref}" found while packaging manifest`,
				);
			}
			seenRefs.add(ref);
		}

		const packagedQuills: QuillMetadata[] = [];
		const allFontBlobs = new Map<string, Uint8Array>();
		const fontUsage = new Map<string, Set<string>>();
		const fontNames = new Map<string, string>();
		let strippedBytesTotal = 0;
		for (const entry of manifest.quills) {
			const quillDir = path.join(this.quillsDir, entry.name, entry.version);
			const fileList = await listFilesRecursive(quillDir);
			const zipFiles: Record<string, Uint8Array> = {};
			const fontManifestFiles: Record<string, string> = {};
			const quillRef = `${entry.name}@${entry.version}`;
			for (const filePath of fileList.sort()) {
				const fullPath = path.join(quillDir, filePath);
				const bytes = new Uint8Array(await fs.readFile(fullPath));
				if (isFontPath(filePath)) {
					const hash = createHash('md5').update(bytes).digest('hex');
					strippedBytesTotal += bytes.length;
					fontManifestFiles[filePath] = hash;
					if (!allFontBlobs.has(hash)) {
						allFontBlobs.set(hash, bytes);
					}
					if (!fontUsage.has(hash)) {
						fontUsage.set(hash, new Set());
					}
					fontUsage.get(hash)!.add(quillRef);
					if (!fontNames.has(hash)) {
						fontNames.set(hash, path.basename(filePath));
					}
					continue;
				}
				zipFiles[filePath] = bytes;
			}
			const fontManifest = validateFontManifest({
				version: FONT_MANIFEST_VERSION,
				files: fontManifestFiles,
			});
			zipFiles[FONT_MANIFEST_FILE_NAME] = new TextEncoder().encode(
				JSON.stringify(fontManifest, null, 2),
			);

			const packed = await packFiles(zipFiles);
			const contentHash = md5Prefix6(packed);
			const bundleFileName = `${entry.name}@${entry.version}.${contentHash}.zip`;
			await fs.writeFile(path.join(outputDir, bundleFileName), packed);
			packagedQuills.push({
				...entry,
				bundleFileName,
			});
		}
		for (const [hash, bytes] of allFontBlobs) {
			const storePath = path.join(storeDir, hash);
			try {
				await fs.access(storePath);
			} catch {
				await fs.writeFile(storePath, bytes);
			}
		}

		const summary: FontDehydrationSummary = {
			strippedBytes: strippedBytesTotal,
			fonts: [...fontUsage.keys()].sort().map((hash) => ({
				fileName: fontNames.get(hash) ?? hash,
				hash,
				quillCount: fontUsage.get(hash)!.size,
			})),
		};

		const packagedManifest: QuillManifest = { quills: packagedQuills };
		const manifestJson = JSON.stringify(packagedManifest, null, 2);
		const manifestFileName = `manifest.${md5Prefix6(manifestJson)}.json`;
		await fs.writeFile(path.join(outputDir, manifestFileName), manifestJson);

		return { manifestFileName, summary };
	}

}
