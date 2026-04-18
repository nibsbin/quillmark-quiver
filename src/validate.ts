import { QuillRegistry } from './registry.js';
import type { QuillInfo, QuillmarkEngine, QuillSource } from './types.js';
import { formatUnknownError } from './errors.js';

/**
 * Engine interface for quill validation.
 *
 * Extends the base {@link QuillmarkEngine} with `render()` so the validator
 * can compile each quill's example document end-to-end.
 *
 * Structurally compatible with `@quillmark/wasm`'s `Quillmark` class —
 * pass a `Quillmark` instance directly without adapters:
 *
 * ```ts
 * import { Quillmark } from '@quillmark/wasm';
 * const engine: QuillValidationEngine = new Quillmark();
 * ```
 */
export interface QuillValidationEngine extends QuillmarkEngine {
	render(
		parsed: { fields: Record<string, unknown>; quillName: string },
		opts: { format?: string },
	): { artifacts: Array<{ bytes: Uint8Array }> };
}

/**
 * Options for {@link validateQuills}.
 *
 * Use any {@link QuillSource} (e.g. {@link HttpSource} in the browser). For
 * filesystem-backed validation on Node, use {@link validateQuillsFromDir} from
 * `@quillmark/registry/node`.
 *
 * ```ts
 * import { validateQuills, HttpSource } from '@quillmark/registry';
 * import { Quillmark, init } from '@quillmark/wasm';
 *
 * init();
 * const wasm = new Quillmark();
 * const source = new HttpSource({ baseUrl: 'https://example.com/quills' });
 * try {
 *   const { passed, failed } = await validateQuills({
 *     source,
 *     engine: wasm,
 *     parseMarkdown: Quillmark.parseMarkdown,
 *   });
 * } finally {
 *   wasm.free();
 * }
 * ```
 */
export interface ValidateQuillsOptions {
	/** Quill listing and loading backend (HTTP, in-memory test double, etc.). */
	source: QuillSource;

	/**
	 * Initialised WASM engine instance (e.g. `new Quillmark()` from `@quillmark/wasm`).
	 *
	 * Must support `registerQuill`, `resolveQuill`, `listQuills`, and `render`.
	 */
	engine: QuillValidationEngine;

	/**
	 * Static markdown parser (e.g. `Quillmark.parseMarkdown` from `@quillmark/wasm`).
	 */
	parseMarkdown: (
		markdown: string,
	) => { fields: Record<string, unknown>; quillName: string };
}

/** Validation result for a single quill version. */
export interface QuillValidationEntry {
	name: string;
	version: string;
	/** Whether `registerQuill()` succeeded (validates quill structure). */
	registered: boolean;
	/** Whether the quill's example document rendered to non-empty artifacts. */
	rendered: boolean;
	/** Error message if any validation step failed. */
	error?: string;
}

/** Aggregate result returned by {@link validateQuills}. */
export interface ValidateQuillsResult {
	results: QuillValidationEntry[];
	/** Number of quills that passed all validation steps. */
	passed: number;
	/** Number of quills that failed at least one validation step. */
	failed: number;
}

/**
 * Validates every quill from a {@link QuillSource} by registering it with the WASM engine
 * and rendering its example document when present.
 *
 * Designed for CI gates and local checks. Each quill goes through two validation stages:
 *
 * 1. **Registration** — `registerQuill()` validates the quill's file structure,
 *    `Quill.yaml` schema, and Typst package layout.
 * 2. **Render** — if the quill includes an example document, it is parsed and
 *    rendered to the first supported output format (e.g. PDF), confirming that
 *    the Typst template compiles without error.
 *
 * @returns Per-quill results and aggregate pass/fail counts.
 */
export async function validateQuills(
	options: ValidateQuillsOptions,
): Promise<ValidateQuillsResult> {
	const { source, engine, parseMarkdown } = options;
	const registry = new QuillRegistry({ source, engine });
	const manifest = await source.getManifest();
	const results: QuillValidationEntry[] = [];

	for (const quill of manifest.quills) {
		const entry: QuillValidationEntry = {
			name: quill.name,
			version: quill.version,
			registered: false,
			rendered: false,
		};

		try {
			// Stage 1: load + register (validates quill structure)
			const ref = `${quill.name}@${quill.version}`;
			await registry.resolve(ref);
			entry.registered = true;

			// Stage 2: render the example document
			const info = engine.resolveQuill(quill.name) as QuillInfo | null;
			if (info?.example && info.supportedFormats?.length > 0) {
				// Replace the colon-style QUILL reference (e.g. "name:0.1") with
				// the engine-compatible "@" format (e.g. "name@0.1.0")
				const exampleMd = info.example.replace(/^QUILL:.*$/m, `QUILL: ${ref}`);
				const parsed = parseMarkdown(exampleMd);
				const result = engine.render(parsed, {
					format: info.supportedFormats[0],
				});

				const firstArtifact = result.artifacts[0];
				if (!firstArtifact || firstArtifact.bytes.length === 0) {
					entry.error = 'Render produced no output artifacts';
				} else {
					entry.rendered = true;
				}
			}
		} catch (err) {
			entry.error = formatUnknownError(err);
		}

		results.push(entry);
	}

	const failed = results.filter((r) => r.error !== undefined).length;
	const passed = results.length - failed;

	return { results, passed, failed };
}
