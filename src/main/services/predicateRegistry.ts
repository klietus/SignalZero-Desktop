import { predicateValueIndex } from './predicateIndexService.js';
import { domainService } from './domainService.js';

export interface PredicateField {
  name: string;
  domainId: string;
  operator: 'eq' | 'contains' | 'in' | 'similar';
  description: string;
}

export interface ValidValue {
  field: string;
  value: string;
  count: number;
}

export class PredicateFieldRegistry {
  private knownFields: Map<string, PredicateField> = new Map();

  constructor() {
    this.registerKnownFields();
  }

  /**
   * Register all known predicate fields.
   */
  private registerKnownFields(): void {
    const fields: PredicateField[] = [
      { name: 'function', domainId: '*', operator: 'eq', description: 'Symbol function facet' },
      { name: 'topology', domainId: '*', operator: 'eq', description: 'Symbol topology facet' },
      { name: 'temporal', domainId: '*', operator: 'eq', description: 'Symbol temporal facet' },
      { name: 'kind', domainId: '*', operator: 'eq', description: 'Symbol kind (pattern/lattice/persona/data)' },
      { name: 'tags', domainId: '*', operator: 'contains', description: 'Symbol tags' },
      { name: 'commit', domainId: '*', operator: 'eq', description: 'Symbol commit type (foundational/volatile)' },
      { name: 'role', domainId: '*', operator: 'similar', description: 'Symbol role description' },
      { name: 'macro', domainId: '*', operator: 'similar', description: 'Symbol macro logic' },
      { name: 'triad', domainId: '*', operator: 'eq', description: 'Symbol triad emoji' },
      { name: 'failure_mode', domainId: '*', operator: 'eq', description: 'Symbol failure mode' },
      { name: 'gate', domainId: '*', operator: 'in', description: 'Symbol gate conditions' },
      { name: 'substrate', domainId: '*', operator: 'in', description: 'Symbol substrate layers' },
      { name: 'invariants', domainId: '*', operator: 'in', description: 'Symbol invariants' },
    ];

    for (const field of fields) {
      this.knownFields.set(`${field.domainId}:${field.name}`, field);
    }
  }

  /**
   * Validate a predicate against the registry.
   */
  validatePredicate(predicate: { field: string; value: string; operator?: string }): boolean {
    const key = `*:${predicate.field}`;
    const field = this.knownFields.get(key);
    if (!field) return false;

    if (predicate.operator && predicate.operator !== field.operator) {
      return false;
    }

    return true;
  }

  /**
   * Get all available fields for a domain.
   */
  async getAvailableFields(domainId: string): Promise<string[]> {
    const fields = predicateValueIndex.getFields(domainId);
    return fields.map(f => f.split(':').slice(1).join(':'));
  }

  /**
   * Get all valid values for a field in a domain.
   */
  async getValidValues(field: string, domainId: string): Promise<string[]> {
    const key = `${domainId}:${field}`;
    return predicateValueIndex.getValues(key);
  }

  /**
   * Get the operator for a field.
   */
  getOperator(field: string): string {
    const key = `*:${field}`;
    const f = this.knownFields.get(key);
    return f?.operator || 'eq';
  }

  /**
   * Get field description.
   */
  getDescription(field: string): string {
    const key = `*:${field}`;
    const f = this.knownFields.get(key);
    return f?.description || '';
  }

  /**
   * Check if a field is known.
   */
  hasField(field: string): boolean {
    const key = `*:${field}`;
    return this.knownFields.has(key);
  }

  /**
   * Get all known fields.
   */
  getAllFields(): PredicateField[] {
    return Array.from(this.knownFields.values());
  }
}

export const predicateRegistry = new PredicateFieldRegistry();
