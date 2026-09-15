import { describe, expect, it } from 'vitest';
import {
  makeInsightFriendly,
  makeProgressMessageUserFriendly,
  makeExecutiveSummaryFriendly,
  makeErrorMessageUserFriendly,
  isLlmServiceFallbackText,
  isTransientPlanNarration,
  normalizeInsightInput,
  escapeCurrencyDollarsForMarkdown,
  repairCollapsedMarkdown,
} from './userFriendlyMessages';

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

  it('humanizes snake_case column titles and hides 100% sure', () => {
    const friendly = makeInsightFriendly({
      title: 'accounts_over_100',
      what: 'Total=80.00, Avg=80.00',
      confidence: 1.0,
    });
    expect(friendly.title).toBe('Accounts over 100');
    expect(friendly.confidencePct).toBeNull();
  });

  it('does not treat plan progress as an answer', () => {
    expect(isTransientPlanNarration('I am now planning kpi scope & tier...')).toBe(true);
    expect(isTransientPlanNarration('Customers grew 12% month over month.')).toBe(false);
  });

  it('does not treat live-progress pulse phrases as answer text under the progress card', () => {
    expect(isTransientPlanNarration('Writing the story from your data…')).toBe(true);
    expect(isTransientPlanNarration('Profiling your data…')).toBe(true);
    expect(isTransientPlanNarration('Still working on the visuals…')).toBe(true);
  });

  it('does not treat classic execution-plan step labels as answer text under the progress card', () => {
    expect(isTransientPlanNarration('Fetching historical data...')).toBe(true);
    expect(isTransientPlanNarration('Building the forecast view')).toBe(true);
    expect(isTransientPlanNarration('Projecting Trends')).toBe(true);
    expect(isTransientPlanNarration('Collateral values rose 8% last quarter.')).toBe(false);
  });
});

describe('makeProgressMessageUserFriendly — post-query wait', () => {
  it('does not pass through the raw "Data quality verified" line', () => {
    const msg = makeProgressMessageUserFriendly(
      'post_query_approved',
      'Data quality verified — building visualization...',
    );
    expect(msg.toLowerCase()).not.toContain('data quality verified');
    expect(msg.toLowerCase()).toMatch(/chart|insight/);
  });

  it('unwraps Step N/M prefixes and keeps the forecast quality label', () => {
    const msg = makeProgressMessageUserFriendly(
      'post_query_evaluation',
      'Step 5/7: Validating data for forecasting',
    );
    expect(msg.toLowerCase()).not.toMatch(/^step\s+5/);
    expect(msg.toLowerCase()).toContain('forecast');
  });
});

describe('makeExecutiveSummaryFriendly — LiteLLM fallback', () => {
  it('blanks the canned Connect Data help template', () => {
    const fallback =
      "I understand you're looking for data analysis. While I'm experiencing some technical difficulties with my AI service, I can still help you with: Connect your data source using the \"Connect Data\" button";
    expect(isLlmServiceFallbackText(fallback)).toBe(true);
    expect(makeExecutiveSummaryFriendly(fallback)).toBe('');
  });

  it('translates forecast metric jargon into business language', () => {
    const raw =
      'Prophet MAPE 12.5% on holdout; conformal intervals look fine. ARIMA was close.';
    const friendly = makeExecutiveSummaryFriendly(raw);
    expect(friendly.toLowerCase()).not.toMatch(/\bmape\b/);
    expect(friendly.toLowerCase()).not.toMatch(/\bprophet\b/);
    expect(friendly.toLowerCase()).not.toMatch(/\barima\b/);
    expect(friendly.toLowerCase()).not.toMatch(/\bconformal\b/);
    expect(friendly.toLowerCase()).toMatch(/trend|seasonality|accurate|recent/);
  });
});

describe('escapeCurrencyDollarsForMarkdown', () => {
  it('escapes $40 so KaTeX does not swallow the rest of the sentence', () => {
    expect(escapeCurrencyDollarsForMarkdown('Revenue is $40 across 1 rows.')).toBe(
      'Revenue is \\$40 across 1 rows.',
    );
  });
});

describe('repairCollapsedMarkdown', () => {
  it('restores newlines before headings, lists, and pipe tables crushed into one line', () => {
    const collapsed =
      'No weekly data for 2023. ## What the documents do contain ### Liquidity metrics ' +
      '| Metric | 31 Dec 2024 | 31 Dec 2023 | | --- | --- | --- | | At end of year | 222.30% | 133.05% | ' +
      '- New accounting standards adopted in 2024.';
    const fixed = repairCollapsedMarkdown(collapsed);
    expect(fixed).toContain('\n## What the documents');
    expect(fixed).toContain('\n### Liquidity');
    expect(fixed).toContain('| Metric | 31 Dec 2024 | 31 Dec 2023 |');
    expect(fixed).toContain('| --- | --- | --- |');
    expect(fixed).toContain('| At end of year | 222.30% | 133.05% |');
    expect(fixed).toMatch(/\n-\s+New accounting/);
  });

  it('rebuilds shredded table separators from the live chat failure mode', () => {
    const shredded =
      'Liquidity Coverage Ratio (LCR) — not weekly loan volumes: | Metric | 31 Dec 2024 | 31 Dec 2023 |\n' +
      '|\n' +
      '--- |\n' +
      '--- |\n' +
      '--- | | At end of year | 222.30% | 133.05% | | Average for the year | 144.76% | 127.71% | ' +
      '| Highest LCR during the period | 222.30% | 133.05% | | Lowest LCR during the period | 106.73% | 105.69% |';
    const fixed = repairCollapsedMarkdown(shredded);
    expect(fixed).toMatch(/volumes:\n\n\| Metric/);
    expect(fixed).toContain('| Metric | 31 Dec 2024 | 31 Dec 2023 |');
    expect(fixed).toContain('| --- | --- | --- |');
    expect(fixed).toContain('| At end of year | 222.30% | 133.05% |');
    expect(fixed).toContain('| Average for the year | 144.76% | 127.71% |');
    expect(fixed).toContain('| Lowest LCR during the period | 106.73% | 105.69% |');
    expect(fixed).not.toMatch(/^\|$/m);
    expect(fixed).not.toMatch(/^---\s*\|?\s*$/m);
  });

  it('unescapes literal \\n when the payload has almost no real newlines', () => {
    const escaped = 'Hello\\n\\n## Title\\n- item';
    const fixed = repairCollapsedMarkdown(escaped);
    expect(fixed).toContain('\n## Title');
    expect(fixed).not.toContain('\\n');
  });

  it('leaves already well-formed markdown alone', () => {
    const good = 'Intro paragraph.\n\n## Section\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- bullet';
    expect(repairCollapsedMarkdown(good)).toBe(good.trim());
  });

  it('promotes a bare Executive Summary glued to the body (chat screenshot failure)', () => {
    const glued =
      'Executive Summary The Principal Amount Trend widget is the momentum gauge of this dashboard.';
    const fixed = repairCollapsedMarkdown(glued);
    expect(fixed.startsWith('## Executive Summary\n\nThe Principal')).toBe(true);
    expect(fixed).not.toMatch(/^Executive Summary The Principal/);
  });

  it('splits ## Executive Summary when body is on the same heading line', () => {
    const sameLine =
      '## Executive Summary The Principal Amount Trend widget plots total principal.';
    const fixed = repairCollapsedMarkdown(sameLine);
    expect(fixed).toMatch(/^## Executive Summary\n\nThe Principal/);
  });

  it('leaves a well-formed Executive Summary heading alone', () => {
    const good = '## Executive Summary\n\nThe Principal Amount Trend widget is fine.';
    expect(repairCollapsedMarkdown(good)).toBe(good.trim());
  });
});

describe('makeErrorMessageUserFriendly', () => {
  it('does not present a missing-SQL pipeline error as still waiting', () => {
    expect(makeErrorMessageUserFriendly('No SQL query to validate yet')).not.toMatch(/waiting/i);
    expect(makeErrorMessageUserFriendly('No SQL query to validate yet')).toMatch(/couldn.t generate a query/i);
  });
});
