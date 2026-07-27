import { describe, expect, it } from 'vitest';
import { validateMetricAggregation, validateYMetrics } from './metricValidation';

describe('validateMetricAggregation', () => {
  it('flags sum on text columns', () => {
    const issue = validateMetricAggregation('status', 'sum', 'varchar');
    expect(issue?.severity).toBe('error');
  });

  it('warns on sum of identifier-like fields', () => {
    const issue = validateMetricAggregation('claim_id', 'sum', 'integer');
    expect(issue?.severity).toBe('warning');
  });

  it('allows count on any column', () => {
    expect(validateMetricAggregation('status', 'count', 'varchar')).toBeNull();
  });
});

describe('validateYMetrics', () => {
  it('collects issues across metrics', () => {
    const issues = validateYMetrics(
      [
        { field: 'status', aggregation: 'sum' },
        { field: 'amount', aggregation: 'sum' },
      ],
      [
        { value: 'status', type: 'text' },
        { value: 'amount', type: 'numeric' },
      ],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe('status');
  });
});
