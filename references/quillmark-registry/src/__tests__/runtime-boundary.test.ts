import { describe, it, expect } from 'vitest';
import * as root from '../index.js';
import * as node from '../node.js';

describe('runtime boundary', () => {
	it('root entry does not expose FileSystemSource', () => {
		expect(Object.prototype.hasOwnProperty.call(root, 'FileSystemSource')).toBe(false);
		expect('FileSystemSource' in root).toBe(false);
	});

	it('node subpath exposes FileSystemSource and validateQuillsFromDir', () => {
		expect(node.FileSystemSource).toBeTypeOf('function');
		expect(node.validateQuillsFromDir).toBeTypeOf('function');
	});

	it('root exposes source-based validateQuills', () => {
		expect(root.validateQuills).toBeTypeOf('function');
	});
});
