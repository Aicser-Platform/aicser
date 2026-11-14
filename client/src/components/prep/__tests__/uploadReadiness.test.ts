import { describe, expect, it } from 'vitest';
import { needsCheck } from '../UploadReadinessWatcher';

describe('upload readiness', () => {
  it('checks uploaded files and sheets, not databases', () => {
    expect(needsCheck({ id: '1', type: 'file' })).toBe(true);
    expect(needsCheck({ id: '2', type: 'google_sheets' })).toBe(true);
    expect(needsCheck({ id: '3', type: 'database', db_type: 'postgresql' })).toBe(false);
    expect(needsCheck({ type: 'file' })).toBe(false);
  });
});
