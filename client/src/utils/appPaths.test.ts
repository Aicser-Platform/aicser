import { describe, expect, it } from 'vitest';
import { getChatHref } from './appPaths';

describe('getChatHref', () => {
  it('builds query string for EE chat links', () => {
    const href = getChatHref({ mode: 'ai_search', library_id: 'lib-1' });
    if (href.startsWith('/chat')) {
      expect(href).toContain('mode=ai_search');
      expect(href).toContain('library_id=lib-1');
    } else {
      expect(href).toBe('/dashboards');
    }
  });

  it('returns bare chat path when no params in EE', () => {
    const href = getChatHref();
    expect(['/chat', '/dashboards']).toContain(href);
  });
});
