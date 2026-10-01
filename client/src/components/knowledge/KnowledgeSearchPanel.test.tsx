import { describe, it, expect } from 'vitest';

describe('KnowledgeSearchPanel contract', () => {
  it('exports search panel module', async () => {
    const mod = await import('./KnowledgeSearchPanel');
    expect(typeof mod.KnowledgeSearchPanel).toBe('function');
    // A cold import of the panel's dependency tree passes 10 s when the whole suite runs at once.
  }, 30_000);
});
