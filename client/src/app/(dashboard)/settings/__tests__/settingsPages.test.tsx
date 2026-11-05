import { describe, expect, it } from 'vitest';
import { MOVED_TABS, SETTINGS_SECTIONS, groupSettingsPages } from '../settingsPages';

const ALL_SETTINGS = [
  'access-overview', 'adoption', 'menu', 'agent-budget', 'agent-capabilities', 'agent-mcp', 'agent-rules', 'agent-skills', 'ai-decision-layer', 'ai-memory', 'ai-quality', 'ai-residency', 'answer-style', 'api-keys', 'audit', 'billing-subscription', 'data-shares', 'ecosystem', 'embed', 'general', 'identity', 'integrations', 'lakehouse', 'license', 'notifications', 'organization', 'personal-license', 'privacy', 'profile', 'project', 'publishing', 'releases', 'roles', 'security', 'team', 'usage',
];
const item = (key: string) => ({ key, label: key, description: `${key} desc` });

describe('Settings pages', () => {
  it('holds every setting exactly once, on 21 pages', () => {
    const listed = SETTINGS_SECTIONS.flatMap((s) => s.pages.flatMap((p) => p.keys));
    expect([...listed].sort()).toEqual([...ALL_SETTINGS].sort());
    expect(SETTINGS_SECTIONS.flatMap((s) => s.pages)).toHaveLength(21);
  });

  it('shows a page only with the settings this person may open, named after a lone setting', () => {
    const groups = groupSettingsPages(['profile', 'team', 'roles', 'usage'].map(item));
    const pages = groups.flatMap((g) => g.pages);
    expect(pages.map((p) => p.id)).toEqual(['profile', 'team', 'usage']);
    expect(pages[0].label).toBe('profile'); // only Profile is visible: the page takes its name
    expect(pages[1].label).toBe('Team & roles');
    expect(pages[1].items.map((i) => i.key)).toEqual(['team', 'roles']);
    expect(groups.map((g) => g.id)).toEqual(['account', 'organization', 'billing']);
  });

  it('keeps an unplaced setting visible under Project', () => {
    const groups = groupSettingsPages([item('something-new')]);
    expect(groups[0].id).toBe('project');
    expect(groups[0].pages[0].items[0].key).toBe('something-new');
  });

  it('sends Briefings to Automations', () => {
    expect(MOVED_TABS.briefings).toBe('/agent?tab=schedules');
  });
});
