import { describe, expect, it } from 'vitest';
import {
  analyzeCompleteFromEvent,
  isAnalyzeCompleteEvent,
  pickAnalyzeSummary,
} from '@/agent/analyzeStreamComplete';

describe('analyzeStreamComplete', () => {
  it('detects complete events', () => {
    expect(isAnalyzeCompleteEvent({ type: 'complete' })).toBe(true);
    expect(isAnalyzeCompleteEvent({ workflow_complete: true })).toBe(true);
    expect(isAnalyzeCompleteEvent({ type: 'progress' })).toBe(false);
  });

  it('reads the proposed change set from partial_results', () => {
    const result = analyzeCompleteFromEvent({
      type: 'complete',
      partial_results: {
        message: 'I will add a summary tab.',
        surface_actions: [{ type: 'sheet_changes', sheets: [{ name: 'Summary' }] }],
      },
    });
    expect(result.message).toBe('I will add a summary tab.');
    expect((result.surface_actions as Array<{ type: string }>)[0].type).toBe('sheet_changes');
  });

  it('pickAnalyzeSummary prefers answer in partial_results', () => {
    expect(
      pickAnalyzeSummary({
        partial_results: { answer: 'Hello' },
      }),
    ).toBe('Hello');
  });
});
