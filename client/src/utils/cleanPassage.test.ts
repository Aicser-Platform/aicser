import { describe, expect, it } from 'vitest';
import { cleanPassage } from '@/components/knowledge/KnowledgeSearchPanel';

describe('cleanPassage', () => {
  it('turns markdown table fragments into readable lines', () => {
    const out = cleanPassage('|**In US$000**|(11,357)|\n|---|---|\n|(45,714)<br>(48,425)|');
    expect(out).not.toMatch(/<br>|\*\*|---/);
    expect(out).toContain('In US$000');
    expect(out).toContain('(48,425)');
  });
  it('leaves prose alone', () => {
    expect(cleanPassage('Notes to the financial statements')).toBe('Notes to the financial statements');
  });
});
