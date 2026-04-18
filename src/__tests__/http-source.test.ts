import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { HttpSource } from '../sources/http-source.js';
import { RegistryError } from '../errors.js';
import type { QuillManifest } from '../types.js';
import { packFiles } from '../bundle.js';

const MANIFEST_FILE = 'manifest.test99.json';

const MANIFEST: QuillManifest = {
	quills: [
		{
			name: 'usaf_memo',
			version: '1.0.0',
			description: 'USAF Memo',
			bundleFileName: 'usaf_memo@1.0.0.aaaaaaaa.zip',
		},
		{
			name: 'classic_resume',
			version: '2.1.0',
			bundleFileName: 'classic_resume@2.1.0.bbbbbb.zip',
		},
	],
};

/** Creates a mock zip bundle containing test files. */
async function createMockBundle(version: string = '1.0.0'): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	const packed = await packFiles({
		'Quill.yaml': encoder.encode(`name: usaf_memo\nversion: ${version}`),
		'template.typ': encoder.encode('// Template'),
	});
	return packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
}

function md5Hex(data: Uint8Array): string {
	return createHash('md5').update(data).digest('hex');
}

async function createMockDehydratedBundle(
	version: string,
	fontPath: string,
	fontBytes: Uint8Array,
): Promise<{ zip: ArrayBuffer; hash: string }> {
	const hash = md5Hex(fontBytes);
	const encoder = new TextEncoder();
	const packed = await packFiles({
		'Quill.yaml': encoder.encode(`name: usaf_memo\nversion: ${version}`),
		'template.typ': encoder.encode('// Template'),
		'fonts.json': encoder.encode(
			JSON.stringify({
				version: 1,
				files: {
					[fontPath]: hash,
				},
			}),
		),
	});
	return {
		zip: packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength),
		hash,
	};
}

/** Creates a mock fetch function with programmable responses. */
function createMockFetch(
	responses: Record<string, { ok: boolean; status?: number; body?: unknown }>,
) {
	return vi.fn(async (url: string | URL | Request) => {
		const urlStr = typeof url === 'string' ? url : url.toString();
		for (const [pattern, config] of Object.entries(responses)) {
			if (urlStr.includes(pattern)) {
				if (!config.ok) {
					return new Response(null, {
						status: config.status ?? 500,
						statusText: 'Error',
					});
				}
				if (config.body instanceof ArrayBuffer) {
					return new Response(config.body);
				}
				return new Response(JSON.stringify(config.body));
			}
		}
		return new Response(null, { status: 404, statusText: 'Not Found' });
	}) as unknown as typeof globalThis.fetch;
}

describe('HttpSource', () => {
	it('should require manifestFileName when manifest is not preloaded', () => {
		expect(
			() =>
				new HttpSource({
					baseUrl: 'https://cdn.example.com/quills/',
				}),
		).toThrow(/manifestFileName/);
	});

	describe('getManifest()', () => {
		it('should fetch manifest from baseUrl', async () => {
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			const manifest = await source.getManifest();
			expect(manifest.quills).toHaveLength(2);
			expect(mockFetch).toHaveBeenCalledWith(
				`https://cdn.example.com/quills/${MANIFEST_FILE}`,
			);
		});

		it('should use pre-loaded manifest when provided', async () => {
			const mockFetch = vi.fn() as unknown as typeof globalThis.fetch;
			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifest: MANIFEST,
				fetch: mockFetch,
			});

			const manifest = await source.getManifest();
			expect(manifest.quills).toHaveLength(2);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('should cache fetched manifest', async () => {
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			await source.getManifest();
			await source.getManifest();
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('should throw source_unavailable on network error', async () => {
			const mockFetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof globalThis.fetch;

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			try {
				await source.getManifest();
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(RegistryError);
				expect((err as RegistryError).code).toBe('source_unavailable');
			}
		});

		it('should throw source_unavailable on non-ok response', async () => {
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: false, status: 404 },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			try {
				await source.getManifest();
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(RegistryError);
				expect((err as RegistryError).code).toBe('source_unavailable');
			}
		});
	});

	describe('loadQuill()', () => {
		it('should fetch and decompress a quill', async () => {
			const brData = await createMockBundle();
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
				'usaf_memo@1.0.0.aaaaaaaa.zip': { ok: true, body: brData },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			const bundle = await source.loadQuill('usaf_memo', '1.0.0');

			expect(bundle.name).toBe('usaf_memo');
			expect(bundle.version).toBe('1.0.0');
			expect(bundle.metadata.name).toBe('usaf_memo');
			expect(bundle.metadata.description).toBe('USAF Memo');

			const data = bundle.data as { files: Record<string, unknown> };
			expect(data.files['Quill.yaml']).toBeDefined();
			expect(data.files['template.typ']).toBeDefined();
		});

		it('should rehydrate fonts from /store and remove fonts.json before returning', async () => {
			const fontBytes = new Uint8Array([11, 12, 13, 14]);
			const { zip, hash } = await createMockDehydratedBundle(
				'1.0.0',
				'assets/fonts/Inter-Regular.ttf',
				fontBytes,
			);
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
				'usaf_memo@1.0.0.aaaaaaaa.zip': { ok: true, body: zip },
				[`store/${hash}`]: {
					ok: true,
					body: fontBytes.buffer.slice(
						fontBytes.byteOffset,
						fontBytes.byteOffset + fontBytes.byteLength,
					),
				},
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			const bundle = await source.loadQuill('usaf_memo', '1.0.0');
			const data = bundle.data as { files: Record<string, unknown> };
			expect(data.files['fonts.json']).toBeUndefined();
			const assets = data.files['assets'] as Record<string, unknown>;
			const fonts = assets['fonts'] as Record<string, unknown>;
			expect(fonts['Inter-Regular.ttf']).toBeDefined();
		});

		it('should cache font bytes across quill loads by md5 hash', async () => {
			const manifest: QuillManifest = {
				quills: [
					{ name: 'usaf_memo', version: '1.0.0', bundleFileName: 'usaf_memo@1.0.0.aaaaaaaa.zip' },
					{
						name: 'classic_resume',
						version: '2.1.0',
						bundleFileName: 'classic_resume@2.1.0.bbbbbb.zip',
					},
				],
			};
			const fontBytes = new Uint8Array([22, 23, 24, 25]);
			const usafZip = await createMockDehydratedBundle(
				'1.0.0',
				'assets/fonts/Inter-Regular.ttf',
				fontBytes,
			);
			const resumeZip = await createMockDehydratedBundle(
				'2.1.0',
				'assets/fonts/Inter-Regular.ttf',
				fontBytes,
			);
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: manifest },
				'usaf_memo@1.0.0.aaaaaaaa.zip': { ok: true, body: usafZip.zip },
				'classic_resume@2.1.0.bbbbbb.zip': { ok: true, body: resumeZip.zip },
				[`store/${usafZip.hash}`]: {
					ok: true,
					body: fontBytes.buffer.slice(
						fontBytes.byteOffset,
						fontBytes.byteOffset + fontBytes.byteLength,
					),
				},
			});
			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			await source.loadQuill('usaf_memo', '1.0.0');
			await source.loadQuill('classic_resume', '2.1.0');

			const fontFetchCalls = mockFetch.mock.calls
				.map((call) => call[0]?.toString() ?? '')
				.filter((url) => url.includes(`/store/${usafZip.hash}`));
			expect(fontFetchCalls).toHaveLength(1);
		});

		it('should not duplicate font fetches for concurrent quill loads sharing a hash', async () => {
			const manifest: QuillManifest = {
				quills: [
					{ name: 'usaf_memo', version: '1.0.0', bundleFileName: 'usaf_memo@1.0.0.aaaaaaaa.zip' },
					{ name: 'classic_resume', version: '2.1.0', bundleFileName: 'classic_resume@2.1.0.bbbbbb.zip' },
				],
			};
			const fontBytes = new Uint8Array([33, 34, 35, 36]);
			const usafZip = await createMockDehydratedBundle('1.0.0', 'assets/fonts/Inter-Regular.ttf', fontBytes);
			const resumeZip = await createMockDehydratedBundle('2.1.0', 'assets/fonts/Inter-Regular.ttf', fontBytes);
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: manifest },
				'usaf_memo@1.0.0.aaaaaaaa.zip': { ok: true, body: usafZip.zip },
				'classic_resume@2.1.0.bbbbbb.zip': { ok: true, body: resumeZip.zip },
				[`store/${usafZip.hash}`]: {
					ok: true,
					body: fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength),
				},
			});
			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			await Promise.all([
				source.loadQuill('usaf_memo', '1.0.0'),
				source.loadQuill('classic_resume', '2.1.0'),
			]);

			const fontFetchCalls = mockFetch.mock.calls
				.map((call) => call[0]?.toString() ?? '')
				.filter((url) => url.includes(`/store/${usafZip.hash}`));
			expect(fontFetchCalls).toHaveLength(1);
		});

		it('should fail load when a dehydrated font hash cannot be fetched', async () => {
			const fontBytes = new Uint8Array([31, 32, 33, 34]);
			const { zip, hash } = await createMockDehydratedBundle(
				'1.0.0',
				'assets/fonts/Inter-Regular.ttf',
				fontBytes,
			);
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
				'usaf_memo@1.0.0.aaaaaaaa.zip': { ok: true, body: zip },
				[`store/${hash}`]: { ok: false, status: 404 },
			});
			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			await expect(source.loadQuill('usaf_memo', '1.0.0')).rejects.toMatchObject({
				code: 'load_error',
			});
		});

		it('should load the exact requested version regardless of manifest entry order', async () => {
			const manifest: QuillManifest = {
				quills: [
					{ name: 'usaf_memo', version: '1.0.0', bundleFileName: 'usaf_memo@1.0.0.aaaaaaaa.zip' },
					{ name: 'usaf_memo', version: '2.0.0', bundleFileName: 'usaf_memo@2.0.0.bbbbbb.zip' },
				],
			};
			const v1Data = await createMockBundle('1.0.0');
			const v2Data = await createMockBundle('2.0.0');
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: manifest },
				'usaf_memo@1.0.0.aaaaaaaa.zip': { ok: true, body: v1Data },
				'usaf_memo@2.0.0.bbbbbb.zip': { ok: true, body: v2Data },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			const bundle = await source.loadQuill('usaf_memo', '2.0.0');
			expect(bundle.version).toBe('2.0.0');
			expect(mockFetch).toHaveBeenCalledWith(
				'https://cdn.example.com/quills/usaf_memo@2.0.0.bbbbbb.zip',
			);
		});

		it('should fetch bundle URL without cache-busting query string', async () => {
			const brData = await createMockBundle();
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
				'usaf_memo@1.0.0.aaaaaaaa.zip': { ok: true, body: brData },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			await source.loadQuill('usaf_memo', '1.0.0');
			expect(mockFetch).toHaveBeenCalledWith(
				'https://cdn.example.com/quills/usaf_memo@1.0.0.aaaaaaaa.zip',
			);
		});

		it('should throw load_error when manifest entry lacks bundleFileName', async () => {
			const manifest: QuillManifest = {
				quills: [{ name: 'usaf_memo', version: '1.0.0' }],
			};
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: manifest },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			try {
				await source.loadQuill('usaf_memo', '1.0.0');
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(RegistryError);
				expect((err as RegistryError).code).toBe('load_error');
			}
		});

		it('should throw quill_not_found for unknown quill', async () => {
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			try {
				await source.loadQuill('nonexistent', '1.0.0');
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(RegistryError);
				expect((err as RegistryError).code).toBe('quill_not_found');
			}
		});

		it('should throw version_not_found when quill exists but version does not', async () => {
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			try {
				await source.loadQuill('usaf_memo', '9.9.9');
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(RegistryError);
				expect((err as RegistryError).code).toBe('version_not_found');
				expect((err as RegistryError).quillName).toBe('usaf_memo');
				expect((err as RegistryError).version).toBe('9.9.9');
			}
		});

		it('should throw load_error on fetch failure for bundle', async () => {
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
				'usaf_memo@1.0.0.aaaaaaaa.zip': { ok: false, status: 500 },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			try {
				await source.loadQuill('usaf_memo', '1.0.0');
				expect.unreachable('Should have thrown');
			} catch (err) {
				expect(err).toBeInstanceOf(RegistryError);
				expect((err as RegistryError).code).toBe('load_error');
			}
		});
	});

	describe('URL normalization', () => {
		it('should add trailing slash to baseUrl if missing', async () => {
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			await source.getManifest();
			expect(mockFetch).toHaveBeenCalledWith(`https://cdn.example.com/quills/${MANIFEST_FILE}`);
		});

		it('should not double trailing slash', async () => {
			const mockFetch = createMockFetch({
				[MANIFEST_FILE]: { ok: true, body: MANIFEST },
			});

			const source = new HttpSource({
				baseUrl: 'https://cdn.example.com/quills/',
				manifestFileName: MANIFEST_FILE,
				fetch: mockFetch,
			});

			await source.getManifest();
			expect(mockFetch).toHaveBeenCalledWith(`https://cdn.example.com/quills/${MANIFEST_FILE}`);
		});
	});
});
