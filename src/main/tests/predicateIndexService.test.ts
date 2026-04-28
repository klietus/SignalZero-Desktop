import { describe, it, expect, beforeEach, vi } from 'vitest';
import { predicateValueIndex } from '../services/predicateIndexService.js';
import { predicateRegistry } from '../services/predicateRegistry.js';

describe('predicateValueIndex — addValue', () => {
    beforeEach(() => {
        predicateValueIndex.clear();
    });

    it('should add a value to the index', () => {
        const embedding = [0.1, 0.2, 0.3];
        predicateValueIndex.addValue('test:function', 'anchor', embedding, 'test-domain');

        const values = predicateValueIndex.getValues('test:function');
        expect(values).toContain('anchor');
    });

    it('should store multiple values for same field', () => {
        predicateValueIndex.addValue('test:function', 'anchor', [0.1, 0.2, 0.3], 'test-domain');
        predicateValueIndex.addValue('test:function', 'processor', [0.4, 0.5, 0.6], 'test-domain');

        const values = predicateValueIndex.getValues('test:function');
        expect(values).toHaveLength(2);
        expect(values).toContain('anchor');
        expect(values).toContain('processor');
    });

    it('should support multiple fields', () => {
        predicateValueIndex.addValue('test:function', 'anchor', [0.1, 0.2, 0.3], 'test-domain');
        predicateValueIndex.addValue('test:topology', 'inductive', [0.4, 0.5, 0.6], 'test-domain');

        expect(predicateValueIndex.getValues('test:function')).toContain('anchor');
        expect(predicateValueIndex.getValues('test:topology')).toContain('inductive');
    });
});

describe('predicateValueIndex — removeValue', () => {
    beforeEach(() => {
        predicateValueIndex.clear();
    });

    it('should remove a value from the index', () => {
        predicateValueIndex.addValue('test:function', 'anchor', [0.1, 0.2, 0.3], 'test-domain');
        predicateValueIndex.removeValue('test:function', 'anchor');

        const values = predicateValueIndex.getValues('test:function');
        expect(values).not.toContain('anchor');
    });

    it('should handle removing non-existent value', () => {
        expect(() => predicateValueIndex.removeValue('test:function', 'nonexistent')).not.toThrow();
    });
});

describe('predicateValueIndex — snap', () => {
    beforeEach(() => {
        predicateValueIndex.clear();
    });

    it('should return best matching value by cosine similarity', () => {
        predicateValueIndex.addValue('test:function', 'anchor', [1, 0, 0], 'test-domain');
        predicateValueIndex.addValue('test:function', 'processor', [0, 1, 0], 'test-domain');
        predicateValueIndex.addValue('test:function', 'output', [0, 0, 1], 'test-domain');

        const query = [0.9, 0.1, 0.1]; // Close to anchor
        const result = predicateValueIndex.snap('test:function', query);

        expect(result).not.toBeNull();
        expect(result!.value).toBe('anchor');
        expect(result!.similarity).toBeGreaterThan(0.9);
    });

    it('should return null when field has no values', () => {
        const result = predicateValueIndex.snap('empty:function', [0.1, 0.2, 0.3]);
        expect(result).toBeNull();
    });

    it('should return null when query embedding is empty', () => {
        predicateValueIndex.addValue('test:function', 'anchor', [1, 0, 0], 'test-domain');
        const result = predicateValueIndex.snap('test:function', []);
        expect(result).toBeNull();
        expect(result).toBeNull();
    });
});

describe('predicateValueIndex — getFields', () => {
    beforeEach(() => {
        predicateValueIndex.clear();
    });

    it('should return fields for a domain', () => {
        predicateValueIndex.addValue('root:function', 'anchor', [0.1, 0.2, 0.3], 'root');
        predicateValueIndex.addValue('root:topology', 'invariant', [0.4, 0.5, 0.6], 'root');
        predicateValueIndex.addValue('other:function', 'other', [0.7, 0.8, 0.9], 'other');

        const fields = predicateValueIndex.getFields('root');
        expect(fields).toContain('root:function');
        expect(fields).toContain('root:topology');
        expect(fields).not.toContain('other:function');
    });

    it('should return empty array for domain with no fields', () => {
        const fields = predicateValueIndex.getFields('nonexistent');
        expect(fields).toHaveLength(0);
    });
});

describe('predicateValueIndex — clear', () => {
    it('should clear all indexed data', () => {
        predicateValueIndex.addValue('test:function', 'anchor', [0.1, 0.2, 0.3], 'test-domain');
        predicateValueIndex.addValue('test:topology', 'inductive', [0.4, 0.5, 0.6], 'test-domain');

        predicateValueIndex.clear();

        expect(predicateValueIndex.getFields('test')).toHaveLength(0);
    });
});

describe('predicateValueIndex — cosine similarity', () => {
    it('should compute similarity correctly for identical vectors', () => {
        const a = [1, 0, 0];
        const b = [1, 0, 0];
        // Access private method via the index
        predicateValueIndex.addValue('test:function', 'a', a, 'test');
        const result = predicateValueIndex.snap('test:function', b);
        expect(result!.similarity).toBeCloseTo(1.0, 5);
    });

    it('should compute similarity correctly for orthogonal vectors', () => {
        predicateValueIndex.addValue('test:function', 'a', [1, 0, 0], 'test');
        predicateValueIndex.addValue('test:function', 'b', [0, 1, 0], 'test');
        const result = predicateValueIndex.snap('test:function', [0.5, 0.5, 0]);
        expect(result).not.toBeNull();
        // Both have same similarity to query, so either could be returned
        expect(['a', 'b']).toContain(result!.value);
    });

    it('should find exact match with similarity 1.0', () => {
        predicateValueIndex.addValue('test:function', 'a', [1, 0, 0], 'test');
        predicateValueIndex.addValue('test:function', 'b', [-1, 0, 0], 'test');
        const result = predicateValueIndex.snap('test:function', [-1, 0, 0]);
        expect(result).not.toBeNull();
        expect(result!.value).toBe('b');
        expect(result!.similarity).toBeCloseTo(1.0, 5);
    });
});

describe('predicateRegistry — known fields', () => {
    it('should have function field registered', () => {
        expect(predicateRegistry.hasField('function')).toBe(true);
    });

    it('should have topology field registered', () => {
        expect(predicateRegistry.hasField('topology')).toBe(true);
    });

    it('should have kind field registered', () => {
        expect(predicateRegistry.hasField('kind')).toBe(true);
    });

    it('should have tags field registered', () => {
        expect(predicateRegistry.hasField('tags')).toBe(true);
    });

    it('should have commit field registered', () => {
        expect(predicateRegistry.hasField('commit')).toBe(true);
    });

    it('should return correct operator for field', () => {
        expect(predicateRegistry.getOperator('function')).toBe('eq');
        expect(predicateRegistry.getOperator('tags')).toBe('contains');
        expect(predicateRegistry.getOperator('gate')).toBe('in');
        expect(predicateRegistry.getOperator('role')).toBe('similar');
    });

    it('should return description for field', () => {
        expect(predicateRegistry.getDescription('function')).toContain('function');
        expect(predicateRegistry.getDescription('topology')).toContain('topology');
    });

    it('should validate correct predicates', () => {
        expect(predicateRegistry.validatePredicate({ field: 'function', value: 'anchor' })).toBe(true);
        expect(predicateRegistry.validatePredicate({ field: 'kind', value: 'pattern' })).toBe(true);
        expect(predicateRegistry.validatePredicate({ field: 'tags', value: 'core' })).toBe(true);
    });

    it('should reject invalid field predicates', () => {
        expect(predicateRegistry.validatePredicate({ field: 'nonexistent', value: 'test' })).toBe(false);
    });

    it('should reject wrong operator', () => {
        expect(predicateRegistry.validatePredicate({ field: 'function', value: 'anchor', operator: 'contains' })).toBe(false);
    });

    it('should return all known fields', () => {
        const fields = predicateRegistry.getAllFields();
        expect(fields.length).toBeGreaterThan(0);
        const fieldNames = fields.map(f => f.name);
        expect(fieldNames).toContain('function');
        expect(fieldNames).toContain('topology');
        expect(fieldNames).toContain('kind');
    });
});
