import { describe, expect, it, vi } from 'vitest';
import { resolveManifestFileName } from '../bootstrap.js';
import { RegistryError } from '../errors.js';

function createMockFetch(
	responses: Record<string, { ok: boolean; status?: number; statusText?: string; body?: string }>,
) {
	return vi.fn(async (url: string | URL | Request) => {
		const urlStr = typeof url === 'string' ? url : url.toString();
		for (const [pattern, config] of Object.entries(responses)) {
			if (urlStr.includes(pattern)) {
				if (!config.ok) {
					return new Response(null, {
						status: config.status ?? 500,
						statusText: config.statusText ?? 'Error',
					});
				}
				return new Response(config.body ?? '');
			}
		}
		return new Response(null, { status: 404, statusText: 'Not Found' });
	}) as unknown as typeof globalThis.fetch;
}

describe('resolveManifestFileName()', () => {
	it('resolves plain-text pointer payload', async () => {
		const mockFetch = createMockFetch({
			'manifest.json': { ok: true, body: 'manifest.a1b2c3.json' },
		});

		const manifestFileName = await resolveManifestFileName({
			baseUrl: 'https://cdn.example.com/quills',
			fetch: mockFetch,
		});

		expect(manifestFileName).toBe('manifest.a1b2c3.json');
		expect(mockFetch).toHaveBeenCalledWith('https://cdn.example.com/quills/manifest.json');
	});

	it('resolves JSON pointer payload', async () => {
		const mockFetch = createMockFetch({
			'manifest.json': { ok: true, body: JSON.stringify({ manifestFileName: 'manifest.abc123.json' }) },
		});

		const manifestFileName = await resolveManifestFileName({
			baseUrl: 'https://cdn.example.com/quills/',
			fetch: mockFetch,
		});

		expect(manifestFileName).toBe('manifest.abc123.json');
	});

	it('supports custom bootstrap pointer filename', async () => {
		const mockFetch = createMockFetch({
			'latest-manifest.json': { ok: true, body: 'manifest.cafe42.json' },
		});

		const manifestFileName = await resolveManifestFileName({
			baseUrl: 'https://cdn.example.com/quills/',
			bootstrapFileName: 'latest-manifest.json',
			fetch: mockFetch,
		});

		expect(manifestFileName).toBe('manifest.cafe42.json');
		expect(mockFetch).toHaveBeenCalledWith('https://cdn.example.com/quills/latest-manifest.json');
	});

	it('throws source_unavailable on network failure', async () => {
		const mockFetch = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof globalThis.fetch;

		await expect(
			resolveManifestFileName({
				baseUrl: 'https://cdn.example.com/quills/',
				fetch: mockFetch,
			}),
		).rejects.toMatchObject<Partial<RegistryError>>({ code: 'source_unavailable' });
	});

	it('throws source_unavailable on non-ok response', async () => {
		const mockFetch = createMockFetch({
			'manifest.json': { ok: false, status: 404, statusText: 'Not Found' },
		});

		await expect(
			resolveManifestFileName({
				baseUrl: 'https://cdn.example.com/quills/',
				fetch: mockFetch,
			}),
		).rejects.toMatchObject<Partial<RegistryError>>({ code: 'source_unavailable' });
	});

	it('throws source_unavailable on invalid JSON pointer payload', async () => {
		const mockFetch = createMockFetch({
			'manifest.json': { ok: true, body: '{"manifestFileName":42}' },
		});

		await expect(
			resolveManifestFileName({
				baseUrl: 'https://cdn.example.com/quills/',
				fetch: mockFetch,
			}),
		).rejects.toMatchObject<Partial<RegistryError>>({ code: 'source_unavailable' });
	});

	it('throws source_unavailable when pointer payload is empty', async () => {
		const mockFetch = createMockFetch({
			'manifest.json': { ok: true, body: '   ' },
		});

		await expect(
			resolveManifestFileName({
				baseUrl: 'https://cdn.example.com/quills/',
				fetch: mockFetch,
			}),
		).rejects.toMatchObject<Partial<RegistryError>>({ code: 'source_unavailable' });
	});
});
