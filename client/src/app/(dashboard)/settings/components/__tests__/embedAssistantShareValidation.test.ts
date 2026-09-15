import { describe, expect, it } from 'vitest';
import { validateShareTarget } from '../embedAssistantShareValidation';

describe('validateShareTarget', () => {
  it('accepts a colleague email alone', () => {
    expect(validateShareTarget({ shared_with: 'a@example.com' })).toBeNull();
  });

  it('accepts a project alone', () => {
    expect(validateShareTarget({ project_id: 'proj-1' })).toBeNull();
  });

  it('rejects both set at once', () => {
    expect(
      validateShareTarget({ shared_with: 'a@example.com', project_id: 'proj-1' })
    ).not.toBeNull();
  });

  it('rejects neither set', () => {
    expect(validateShareTarget({})).not.toBeNull();
  });

  it('treats whitespace-only values as unset', () => {
    expect(validateShareTarget({ shared_with: '   ', project_id: '  ' })).not.toBeNull();
  });

  it('uses the custom messages when provided', () => {
    const err = validateShareTarget(
      { shared_with: 'a@example.com', project_id: 'proj-1' },
      { both: 'CUSTOM_BOTH', neither: 'CUSTOM_NEITHER' }
    );
    expect(err).toBe('CUSTOM_BOTH');
  });
});
