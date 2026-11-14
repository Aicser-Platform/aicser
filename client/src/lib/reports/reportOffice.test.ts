import type { JSONContent } from '@tiptap/react';
import { describe, expect, it } from 'vitest';
import { DocumentBodySchema } from '@/lib/docs/model';
import { PresentationBodySchema } from '@/lib/slides/model';
import type { Report } from './report';
import { reportToDocument } from './reportDocument';
import { fitFontSize, reportToPresentation } from './reportSlides';

const report: Report = {
  title: 'Q3 sales review',
  tier: 'standard',
  tierLabel: 'Standard',
  industry: 'Retail',
  preparedFor: 'Dara',
  organization: 'Acme',
  summary: 'Revenue rose **12%**.\n\n- North grew most\n- South was flat',
  sections: [
    {
      id: 'k',
      title: 'Headline numbers',
      type: 'kpi',
      status: 'complete',
      narrative: '',
      keyMetric: '',
      keyMetricValue: '',
      chart: null,
      kpis: [
        { label: 'Revenue', value: '$1.2M' },
        { label: 'Orders', value: '8,400' },
      ],
    },
    {
      id: 's1',
      title: 'Revenue by region',
      type: 'breakdown',
      status: 'complete',
      narrative: 'North leads.',
      keyMetric: 'Top region',
      keyMetricValue: 'North',
      chart: { xAxis: { type: 'category' }, series: [] },
      kpis: [],
    },
    {
      id: 's2',
      title: 'Failed part',
      type: 'ranking',
      status: 'failed',
      narrative: '',
      keyMetric: '',
      keyMetricValue: '',
      chart: null,
      kpis: [],
    },
  ],
  recommendations: [
    { title: 'Grow North', action: 'Double the North budget', rationale: 'Best return', priority: 'high' },
  ],
  followUps: ['What drove North?'],
};

const texts = (node: JSONContent): string[] =>
  node.type === 'text' ? [node.text ?? ''] : (node.content ?? []).flatMap(texts);

describe('reports in Docs and Slides', () => {
  it('makes a valid Docs document with every part of the report', () => {
    const doc = reportToDocument(report, new Date('2026-11-13'));
    expect(DocumentBodySchema.safeParse(doc.body).success).toBe(true);
    const all = texts(doc.body.content).join('\n');
    for (const part of [
      'Q3 sales review',
      'Executive summary',
      'Revenue rose 12%.',
      'North grew most',
      'Key metrics',
      '$1.2M',
      '2. Revenue by region',
      'Top region: North',
      'North leads.',
      'Recommendations',
      'Grow North',
      'Questions to explore next',
      'What drove North?',
    ]) {
      expect(all).toContain(part);
    }
    expect(all).not.toContain('Failed part');
    expect(doc.meta.words).toBeGreaterThan(10);
  });

  it('makes a valid Slides presentation: title, summary, sections, recommendations', () => {
    const deck = reportToPresentation(report, new Date('2026-11-13'));
    expect(PresentationBodySchema.safeParse(deck.body).success).toBe(true);
    const all = deck.body.slides.flatMap((s) => s.elements.map((e) => e.text)).join('\n');
    expect(all).toContain('Q3 sales review');
    expect(all).toContain('Revenue by region');
    expect(all).toContain('Grow North');
    expect(all).not.toContain('Failed part');
    expect(deck.meta.slides).toBe(deck.body.slides.length);
  });

  it('shrinks long titles so they fit their box (the cover title was cut off)', () => {
    expect(fitFontSize('Q3 review', 780, 130, 44)).toBe(44);
    // The report that was cut off: at most two lines in the 130 px cover box.
    expect(fitFontSize('Sample: Banking (Cambodia/SEA) Executive Report', 780, 130, 44)).toBeLessThanOrEqual(32);
    const long = 'Sample: Banking (Cambodia/SEA) Executive Report for the Board';
    const size = fitFontSize(long, 780, 130, 44);
    expect(size).toBeLessThan(44);
    const deck = reportToPresentation({ ...report, title: long });
    expect(deck.body.slides[0]?.elements[0]?.style.fontSize).toBe(size);
  });
});

describe('isOfficeHref', () => {
  it('accepts only our Docs / Slides editor pages', async () => {
    const { isOfficeHref } = await import('./openInOffice');
    expect(isOfficeHref('/docs/0a1b-2c')).toBe(true);
    expect(isOfficeHref('/slides/0a1b2c')).toBe(true);
    for (const bad of ['https://evil.example/docs/1', '/settings', '//evil.example/docs/1', '/docs/1?x=1', 42]) {
      expect(isOfficeHref(bad)).toBe(false);
    }
  });
});

describe('openReportInOffice', () => {
  it('opens the file already made from the report instead of a new copy', async () => {
    const { vi } = await import('vitest');
    const docs = await import('@/lib/docs/model');
    const list = vi.spyOn(docs.documentStore, 'list');
    const create = vi.spyOn(docs.documentStore, 'create');
    const { openReportInOffice, reportSource } = await import('./openInOffice');
    const source = reportSource('c1', 'm1');
    const summary = {
      kind: 'document' as const,
      title: 'T',
      visibility: 'private' as const,
      version: 1,
      projectId: null,
      updatedAt: 0,
      role: 'owner' as const,
    };
    list.mockResolvedValue([
      { ...summary, id: 'other', isOwner: true, meta: { source: reportSource('c1', 'm2') } },
      { ...summary, id: 'mine', isOwner: true, meta: { words: 5, source } },
    ]);
    create.mockResolvedValue({ ...summary, id: 'new', isOwner: true, meta: {} });
    expect(await openReportInOffice(report, 'docs', null, source)).toBe('/docs/mine');
    expect(create).not.toHaveBeenCalled();

    list.mockResolvedValue([]);
    expect(await openReportInOffice(report, 'docs', 'p1', source)).toBe('/docs/new');
    expect(create.mock.calls[0]?.[0].meta).toMatchObject({ source });
    expect(create.mock.calls[0]?.[1]).toBe('p1');
    vi.restoreAllMocks();
  });
});
