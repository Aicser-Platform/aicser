import { describe, expect, it } from 'vitest';
import { daysLeft, shareEmbedCode } from '@/services/shareLinks';

describe('share links', () => {
  it('keeps the end date when other options are saved', () => {
    expect(daysLeft(null)).toBeNull();
    expect(daysLeft(new Date(Date.now() + 2.5 * 86_400_000).toISOString())).toBe(3);
  });

  it('builds embed code from the short link, escaping the title', () => {
    const code = shareEmbedCode('abc123', 'Sales "Q1"');
    expect(code).toContain('/s/abc123?embed=1');
    expect(code).toContain('Sales &quot;Q1&quot;');
  });
});
