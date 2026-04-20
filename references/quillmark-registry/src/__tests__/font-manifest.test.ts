import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	isFontPath,
	parseAndValidateFontManifest,
	validateFontManifest,
} from '../font-manifest.js';
import { RegistryError } from '../errors.js';

const FIXTURES_DIR = path.join(
	import.meta.dirname,
	'../../crates/core/tests/fixtures/fonts-manifest',
);

describe('isFontPath', () => {
	it.each(['.ttf', '.otf', '.woff', '.woff2'])('returns true for %s extension', (ext) => {
		expect(isFontPath(`assets/fonts/Inter-Regular${ext}`)).toBe(true);
	});

	it.each(['.TTF', '.OTF', '.WOFF', '.WOFF2'])(
		'returns true for uppercase %s extension',
		(ext) => {
			expect(isFontPath(`assets/fonts/Inter-Regular${ext}`)).toBe(true);
		},
	);

	it.each(['.typ', '.yaml', '.png', '.txt', '.json'])(
		'returns false for %s extension',
		(ext) => {
			expect(isFontPath(`file${ext}`)).toBe(false);
		},
	);
});

describe('validateFontManifest', () => {
	it('accepts a valid manifest', () => {
		const result = validateFontManifest({
			version: 1,
			files: { 'assets/fonts/Inter-Regular.ttf': '3f2a8c1d9e4b5a7f0c8d6e3a1b4f9c2d' },
		});
		expect(result.version).toBe(1);
		expect(result.files['assets/fonts/Inter-Regular.ttf']).toBe(
			'3f2a8c1d9e4b5a7f0c8d6e3a1b4f9c2d',
		);
	});

	it('accepts an empty files map', () => {
		const result = validateFontManifest({ version: 1, files: {} });
		expect(result.files).toEqual({});
	});

	it('accepts duplicate hash values for different paths', () => {
		const hash = '3f2a8c1d9e4b5a7f0c8d6e3a1b4f9c2d';
		const result = validateFontManifest({
			version: 1,
			files: {
				'assets/fonts/Inter-Regular.ttf': hash,
				'packages/foo/fonts/Inter-Regular.ttf': hash,
			},
		});
		expect(Object.keys(result.files)).toHaveLength(2);
	});

	it('rejects unknown top-level keys (additionalProperties: false)', () => {
		expect(() =>
			validateFontManifest({ version: 1, files: {}, extra: 'x' }),
		).toThrow(RegistryError);
	});

	it('rejects null', () => {
		expect(() => validateFontManifest(null)).toThrow(RegistryError);
	});

	it('rejects an array', () => {
		expect(() => validateFontManifest(['version', 1])).toThrow(RegistryError);
	});

	it('rejects wrong version', () => {
		expect(() => validateFontManifest({ version: 2, files: {} })).toThrow(RegistryError);
	});

	it('rejects missing files key', () => {
		expect(() => validateFontManifest({ version: 1 })).toThrow(RegistryError);
	});

	it('rejects files as an array', () => {
		expect(() => validateFontManifest({ version: 1, files: [] })).toThrow(RegistryError);
	});

	it('rejects a non-hex hash', () => {
		expect(() =>
			validateFontManifest({ version: 1, files: { 'font.ttf': 'not-a-valid-hash' } }),
		).toThrow(RegistryError);
	});

	it('rejects an uppercase hash', () => {
		expect(() =>
			validateFontManifest({
				version: 1,
				files: { 'font.ttf': '3F2A8C1D9E4B5A7F0C8D6E3A1B4F9C2D' },
			}),
		).toThrow(RegistryError);
	});

	it('uses load_error code by default', () => {
		try {
			validateFontManifest({ version: 2, files: {} });
		} catch (err) {
			expect(err).toBeInstanceOf(RegistryError);
			expect((err as RegistryError).code).toBe('load_error');
		}
	});

	it('uses provided error code', () => {
		try {
			validateFontManifest({ version: 2, files: {} }, 'source_unavailable');
		} catch (err) {
			expect(err).toBeInstanceOf(RegistryError);
			expect((err as RegistryError).code).toBe('source_unavailable');
		}
	});
});

describe('parseAndValidateFontManifest', () => {
	it('parses valid JSON and validates', () => {
		const raw = new TextEncoder().encode(
			JSON.stringify({ version: 1, files: { 'a.ttf': 'a'.repeat(32) } }),
		);
		const result = parseAndValidateFontManifest(raw);
		expect(result.version).toBe(1);
	});

	it('throws load_error on invalid JSON', () => {
		const raw = new TextEncoder().encode('not-json');
		try {
			parseAndValidateFontManifest(raw);
			expect.unreachable('Should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(RegistryError);
			expect((err as RegistryError).code).toBe('load_error');
		}
	});

	it('throws load_error when JSON is valid but manifest is invalid', () => {
		const raw = new TextEncoder().encode(JSON.stringify({ version: 99, files: {} }));
		try {
			parseAndValidateFontManifest(raw);
			expect.unreachable('Should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(RegistryError);
			expect((err as RegistryError).code).toBe('load_error');
		}
	});
});

describe('shared fixtures (crates/core/tests/fixtures/fonts-manifest)', () => {
	const validFixtures = ['valid.json', 'valid-empty-files.json'];
	const invalidFixtures = [
		'invalid-version.json',
		'invalid-bad-hash.json',
		'invalid-uppercase-hash.json',
		'invalid-missing-files.json',
		'invalid-not-object.json',
	];

	for (const name of validFixtures) {
		it(`accepts valid fixture: ${name}`, async () => {
			const raw = new Uint8Array(await fs.readFile(path.join(FIXTURES_DIR, name)));
			expect(() => parseAndValidateFontManifest(raw)).not.toThrow();
		});
	}

	for (const name of invalidFixtures) {
		it(`rejects invalid fixture: ${name}`, async () => {
			const raw = new Uint8Array(await fs.readFile(path.join(FIXTURES_DIR, name)));
			expect(() => parseAndValidateFontManifest(raw)).toThrow(RegistryError);
		});
	}
});
