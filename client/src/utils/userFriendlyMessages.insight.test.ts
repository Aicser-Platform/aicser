import { describe, expect, it } from 'vitest';
import { makeInsightFriendly, normalizeInsightInput } from './userFriendlyMessages';

describe('normalizeInsightInput', () => {
  it('parses python-style stringified insight dicts', () => {
    const raw =
      "{'type': 'kpi', 'title': 'Declining Loan Disbursal Volume', 'what': 'Loans down 10%', 'so_what': 'Revenue may fall', 'now_what': 'Investigate causes', 'confidence': 0.9}";
    const normalized = normalizeInsightInput(raw);
    expect(normalized.title).toBe('Declining Loan Disbursal Volume');
    expect(normalized.what).toBe('Loans down 10%');
    expect(normalized.confidence).toBe(0.9);
  });

  it('replaces generic Item titles with derived labels', () => {
    const friendly = makeInsightFriendly({
      title: 'Item 1',
      what: 'Total loans disbursed this month are 9, down 10% from last month.',
      confidence: 0.9,
    });
    expect(friendly.title).toContain('Total loans disbursed');
    expect(friendly.confidencePct).toBe(90);
    expect(friendly.what).toContain('down 10%');
  });
});
