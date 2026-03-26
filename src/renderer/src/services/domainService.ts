import { SymbolDef } from '../types';

export const domainService = {

  async createDomain(domainId: string, metadata: { name?: string, description?: string, invariants?: string[] } = {}): Promise<void> {
    // Desktop: Implementation in main later if needed, stub for now
    console.log("Create domain not yet implemented in Desktop IPC", { domainId, metadata });
  },

  async listDomains(): Promise<string[]> {
    return await window.api.listDomains();
  },

  async hasDomain(domainId: string): Promise<boolean> {
    const list = await this.listDomains();
    return list.includes(domainId);
  },

  async isEnabled(_domainId: string): Promise<boolean> {
    return true; // All domains are enabled in Desktop for now
  },

  async toggleDomain(_domainId: string, _enabled: boolean): Promise<void> {
    // Desktop placeholder
  },

  async updateDomainMetadata(_domainId: string, _metadata: { name?: string, description?: string, invariants?: string[] }): Promise<void> {
    // Desktop placeholder
  },

  async deleteDomain(domainId: string): Promise<void> {
    await window.api.deleteDomain(domainId);
  },

  async clearAll(): Promise<void> {
    // Desktop placeholder
  },

  async deleteSymbol(): Promise<void> {
    // Desktop placeholder
  },

  async propagateRename(): Promise<void> {
    // Desktop placeholder
  },

  async getSymbols(_domainId: string): Promise<SymbolDef[]> {
    // Desktop uses search for now
    const results = await window.api.searchSymbols('', 1000, { metadata_filter: { symbol_domain: _domainId } });
    return results.map(r => r.metadata);
  },

  async upsertSymbol(domainId: string, symbol: SymbolDef): Promise<void> {
    await window.api.upsertSymbol(domainId, symbol);
  },

  async bulkUpsert(domainId: string, symbols: SymbolDef[]): Promise<void> {
    for (const sym of symbols) {
      await this.upsertSymbol(domainId, sym);
    }
  },

  async processRefactorOperation(updates: { old_id: string, symbol_data: SymbolDef }[]): Promise<{ count: number, renamedIds: string[] }> {
    for (const update of updates) {
      await this.upsertSymbol(update.symbol_data.symbol_domain, update.symbol_data);
    }
    return { count: updates.length, renamedIds: [] };
  },

  async compressSymbols(newSymbol: SymbolDef, _oldIds: string[]): Promise<{ newId: string, removedIds: string[] }> {
    await this.upsertSymbol(newSymbol.symbol_domain, newSymbol);
    return { newId: newSymbol.id, removedIds: _oldIds };
  },

  async query(domainId: string, tag?: string, limit: number = 20, lastId?: string): Promise<any> {
    const symbols = await this.getSymbols(domainId);
    let filtered = symbols;
    if (tag) filtered = filtered.filter(s => s.symbol_tag?.includes(tag));
    let startIndex = 0;
    if (lastId) {
      const idx = filtered.findIndex(s => s.id === lastId);
      if (idx !== -1) startIndex = idx + 1;
    }
    return { items: filtered.slice(startIndex, startIndex + limit), total: filtered.length, source: 'ipc_proxy' };
  },

  async findById(id: string): Promise<SymbolDef | null> {
    const res = await window.api.searchSymbols(id, 1, { metadata_filter: { id } });
    return res.length > 0 ? res[0].metadata : null;
  },

  async getMetadata(): Promise<any[]> {
    return await window.api.getMetadata();
  }
};
