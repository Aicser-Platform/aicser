import { describe, expect, it } from 'vitest';
import { buildSignedEmbedSnippets, normalizeEmbedDomain, withDashboardView } from '../utils/embedSnippet';

describe('embed code helpers', () => {
  it('keeps the dashboard page and filters on a server-made link', () => {
    const url = new URL(withDashboardView('https://app.aicser.com/embed/dashboard/d1?token=t', 'p2', [{ field: 'country', value: 'KH' }]));
    expect(url.searchParams.get('token')).toBe('t');
    expect(url.searchParams.get('page')).toBe('p2');
    expect(JSON.parse(decodeURIComponent(url.searchParams.get('filters')!))).toEqual([{ field: 'country', value: 'KH' }]);
    expect(new URL(withDashboardView('https://a.b/embed/dashboard/d1', null, [])).search).toBe('');
  });

  it('reduces whatever is typed to the hostname the embed checks', () => {
    expect(normalizeEmbedDomain(' https://App.Example.com:8443/page ')).toBe('app.example.com');
    expect(normalizeEmbedDomain('example.com')).toBe('example.com');
    expect(normalizeEmbedDomain('  ')).toBe('');
  });

  it('writes server code for this chart, never with a real key', () => {
    const s = buildSignedEmbedSnippets({ baseUrl: 'https://app.aicser.com', scope: 'chart', resourceId: 'c-123' });
    expect(s.node).toContain("scope: 'chart'");
    expect(s.node).toContain("resourceId: 'c-123'");
    expect(s.python).toContain('resource_id="c-123"');
    expect(s.curl).toContain("'https://app.aicser.com/api/embed/sign'");
    for (const code of Object.values(s)) expect(code).toContain('AICSER_API_KEY');
  });
});
