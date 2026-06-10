import { describe, it, expect } from 'vitest';

describe('KnowledgeSearchPanel contract', () => {
  it('exports search panel module', async () => {
    const mod = await import('./KnowledgeSearchPanel');
    expect(typeof mod.KnowledgeSearchPanel).toBe('function');
  });
});
