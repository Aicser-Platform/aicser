import { describe, expect, it } from 'vitest';
import { classifyWidgetError, getFriendlyWidgetError } from '../widgetErrorDisplay';

describe('classifyWidgetError', () => {
  it('tells an unbound widget apart from a failed load or missing access', () => {
    expect(classifyWidgetError('Widget has no chartId')).toBe('not_connected');
    expect(classifyWidgetError('Request failed with status code 403')).toBe('no_access');
    expect(classifyWidgetError('Binder Error: Referenced column "x" not found')).toBe('field');
    expect(classifyWidgetError('statement timed out')).toBe('timeout');
    expect(classifyWidgetError('Query execution failed')).toBe('query');
    expect(classifyWidgetError('')).toBe('load_failed');
  });

  it('does not offer Retry when retrying cannot help', () => {
    const t = (k: string) => k;
    expect(getFriendlyWidgetError('Widget has no chartId', t).retryable).toBe(false);
    expect(getFriendlyWidgetError('forbidden', t).retryable).toBe(false);
    expect(getFriendlyWidgetError('network error', t)).toMatchObject({ retryable: true, title: 'widget_error_load_failed_title' });
  });
});
