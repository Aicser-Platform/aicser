import { describe, expect, it } from 'vitest';
import {
  buildEnterpriseSidebarItems,
  defaultFoldedSections,
  filterSidebarItems,
  flattenNavLinks,
  NAV_HINT_KEYS,
  NAV_LABEL_KEYS,
  NAV_ROUTES,
  openKeysForPathname,
  selectedKeyForPathname,
} from '@/layouts/Navigation/navConfig';
import { EE_MOBILE_TABS, enterpriseMoreNavItems } from '@/layouts/Navigation/mobileNavConfig';
import en from '@/messages/en.json';

describe('job-first navigation', () => {
  it('puts everyday pages first, then foldable Analyze, Predict & decide and Data sections', () => {
    const items = buildEnterpriseSidebarItems(true);
    const top = items.filter((i) => i.kind === 'link').map((i) => i.kind === 'link' && i.key);
    expect(top).toEqual(['chat', 'feed', 'dashboards', 'alerts']);
    const sections = items.filter((i) => i.kind === 'section').map((i) => i.kind === 'section' && [i.key, i.children.map((c) => c.key)]);
    expect(sections).toEqual([
      ['sec-analyze', ['chart-designer', 'query-editor', 'sheets', 'notebooks']], // Maps is off by default (NEXT_PUBLIC_FEATURE_MAPS)
      ['sec-predict', ['models', 'ai-decisions']],
      ['sec-data', ['data', 'prepare', 'pipelines', 'semantic-layer', 'catalog', 'knowledge']],
    ]);
    // One level of nesting at most: no groups inside sections.
    expect(items.some((i) => i.kind === 'group')).toBe(false);
    expect(openKeysForPathname('/models/123')).toEqual(['sec-predict']);
  });

  it('every page in the sidebar has a label, a route, a hint and is highlighted on its page', () => {
    const nav = (en as any).nav;
    for (const link of flattenNavLinks(buildEnterpriseSidebarItems(true))) {
      expect(nav[link.labelKey]).toBeTruthy();
      expect(NAV_ROUTES[link.key]).toBe(link.href);
      expect(nav[NAV_HINT_KEYS[link.key]]).toBeTruthy();
      expect(selectedKeyForPathname(link.href)).toBe(link.key);
    }
    expect(nav[NAV_LABEL_KEYS.chat]).toBe('Ask');
    expect(nav[NAV_LABEL_KEYS.feed]).toBe('Shared insights');
    expect(nav[NAV_LABEL_KEYS.knowledge]).toBe('Documents');
    expect(nav[NAV_LABEL_KEYS.data]).toBe('Connections');
    expect(nav[NAV_LABEL_KEYS['chart-designer']]).toBe('Charts');
    expect(nav[NAV_LABEL_KEYS.prepare]).toBe('Prepare');
    expect(nav[NAV_HINT_KEYS.chat]).toMatch(/AI analytics engine/);
  });

  it('folds builder sections for viewers and data plumbing for non-admins', () => {
    expect(defaultFoldedSections({ canBuild: false, canManageData: false })).toEqual(['sec-analyze', 'sec-predict', 'sec-data']);
    expect(defaultFoldedSections({ canBuild: true, canManageData: false })).toEqual(['sec-data']);
    expect(defaultFoldedSections({ canBuild: true, canManageData: true })).toEqual([]);
  });

  it('keeps everyday order and only hides SKU-gated pages', () => {
    const raw = buildEnterpriseSidebarItems(true);
    const top = raw.filter((i) => i.kind === 'link').map((i) => i.kind === 'link' && i.key);
    expect(top).toEqual(['chat', 'feed', 'dashboards', 'alerts']);
    const hidden = filterSidebarItems(raw, { hasFeature: (f) => f !== 'alerts' && f !== 'catalog' });
    const hiddenTop = hidden.filter((i) => i.kind === 'link').map((i) => i.kind === 'link' && i.key);
    expect(hiddenTop).toEqual(['chat', 'feed', 'dashboards']);
    const data = hidden.find((i) => i.kind === 'section' && i.key === 'sec-data');
    expect(data && data.kind === 'section' ? data.children.map((c) => c.key) : []).toEqual([
      'data',
      'prepare',
      'pipelines',
      'semantic-layer',
      'knowledge',
    ]);
  });

  it('mobile tabs follow the same order and More reaches every other page', () => {
    expect(EE_MOBILE_TABS.map((t) => t.key)).toEqual(['chat', 'feed', 'dashboards', 'data']);
    const reachable = new Set([...EE_MOBILE_TABS.map((t) => t.key), ...flattenNavLinks(enterpriseMoreNavItems()).map((l) => l.key)]);
    for (const link of flattenNavLinks(buildEnterpriseSidebarItems(true))) expect(reachable.has(link.key)).toBe(true);
  });

  it('mobile More hides SKU-gated pages without changing remaining order', () => {
    const hidden = filterSidebarItems(enterpriseMoreNavItems(), {
      hasFeature: (f) => f !== 'alerts' && f !== 'catalog',
    });
    expect(flattenNavLinks(hidden).map((l) => l.key)).toEqual([
      'chart-designer',
      'query-editor',
      'sheets',
      'notebooks',
      'models',
      'ai-decisions',
      'prepare',
      'pipelines',
      'semantic-layer',
      'knowledge',
      'settings',
    ]);
  });
});
