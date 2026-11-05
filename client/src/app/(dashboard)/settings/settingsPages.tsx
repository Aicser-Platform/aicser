/**
 * How Settings is organised: by whose settings they are (me, this project, the organization), then AI, sharing, governance and billing; a page holding several settings shows them as tabs.
 * `?tab=` always names one setting, so every old link keeps working.
 */
import React from 'react';
import {
  BankOutlined,
  CreditCardOutlined,
  LineChartOutlined,
  LinkOutlined,
  LockOutlined,
  SafetyOutlined,
  TeamOutlined,
  UserOutlined,
  ProjectOutlined,
} from '@ant-design/icons';

export interface SettingsPageDef {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  /** Settings shown on this page; two or more become tabs. `?tab=` names one of them, so old links stay valid. */
  keys: string[];
}

export const SETTINGS_SECTIONS: { id: string; label: string; pages: SettingsPageDef[] }[] = [
  {
    id: 'account',
    label: 'Me',
    pages: [
      { id: 'profile', label: 'Profile & preferences', description: 'Name, avatar, language, timezone and formats', icon: <UserOutlined />, keys: ['profile', 'general'] },
      { id: 'notifications', label: 'Notifications', keys: ['notifications'] },
      { id: 'security', label: 'Security', keys: ['security'] },
      { id: 'ai-memory', label: 'AI memory', keys: ['ai-memory'] },
      { id: 'api-keys', label: 'API keys', keys: ['api-keys'] },
      { id: 'personal-license', label: 'Aicser Personal', keys: ['personal-license'] },
    ],
  },
  {
    id: 'project',
    label: 'Project',
    pages: [
      { id: 'project', label: 'Project', icon: <ProjectOutlined />, keys: ['project', 'releases'] },
    ],
  },
  {
    id: 'organization',
    label: 'Organization',
    pages: [
      { id: 'organization', label: 'Organization', description: 'Name, branding and license', icon: <BankOutlined />, keys: ['organization', 'license'] },
      { id: 'team', label: 'Team & roles', description: 'Members, invitations and what each role may do', icon: <TeamOutlined />, keys: ['team', 'roles'] },
      { id: 'identity', label: 'Directory sync', keys: ['identity'] },
      { id: 'adoption', label: 'Adoption', keys: ['adoption'] },
      { id: 'lakehouse', label: 'Lakehouse', keys: ['lakehouse'] },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    pages: [
      { id: 'ai-rules', label: 'Rules & models', description: 'Which tools AI may use, what needs approval, and which models decide', icon: <SafetyOutlined />, keys: ['answer-style', 'agent-capabilities', 'agent-skills', 'agent-mcp', 'agent-rules', 'ai-decision-layer'] },
      { id: 'ai-oversight', label: 'Quality & audit', description: 'Answer quality and every AI call', icon: <LineChartOutlined />, keys: ['ai-quality'] },
    ],
  },
  {
    id: 'sharing',
    label: 'Connect & share',
    pages: [
      { id: 'integrations', label: 'Integrations', description: 'Email, Slack, Teams, Microsoft and Google', icon: <LinkOutlined />, keys: ['integrations', 'ecosystem'] },
      { id: 'sharing', label: 'Publishing & embedding', description: 'What may leave the organization, and how', icon: <SafetyOutlined />, keys: ['publishing', 'embed'] },
    ],
  },
  {
    id: 'governance',
    label: 'Governance',
    pages: [
      { id: 'access', label: 'Access & privacy', description: 'Row and column rules, privacy requests and where AI may run', icon: <LockOutlined />, keys: ['access-overview', 'privacy', 'ai-residency'] },
      { id: 'data-shares', label: 'Data shares', keys: ['data-shares'] },
      { id: 'audit', label: 'Audit log', keys: ['audit'] },
    ],
  },
  {
    id: 'billing',
    label: 'Billing',
    pages: [
      { id: 'usage', label: 'Usage & billing', description: 'Usage, plan, invoices and AI spend', icon: <CreditCardOutlined />, keys: ['usage', 'billing-subscription', 'agent-budget'] },
    ],
  },
];

/** Settings that moved out of Settings: their old links land on the new place. */
export const MOVED_TABS: Record<string, string> = {
  briefings: '/agent?tab=schedules',
  'ai-audit-log': '/settings?tab=ai-quality',
};

/** A setting as the page knows it (already filtered to what this person may open, and translated). */
export interface SettingsItemLike {
  key: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

export interface SettingsPage<T extends SettingsItemLike> {
  id: string;
  items: T[];
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

/** The sidebar: groups of pages holding the visible settings. A page with one setting takes its name;
 * a setting no page lists still shows, under Project. */
export function groupSettingsPages<T extends SettingsItemLike>(
  visible: T[],
  tr: (key: string, fallback: string) => string = (_k, f) => f,
): { id: string; label: string; pages: SettingsPage<T>[] }[] {
  const byKey = new Map(visible.map((item) => [item.key, item]));
  const placed = new Set<string>();
  const groups = SETTINGS_SECTIONS.map((section) => ({
    id: section.id,
    label: tr(`group_${section.id}`, section.label),
    pages: section.pages.flatMap((page): SettingsPage<T>[] => {
      const items = page.keys.flatMap((key) => {
        const item = byKey.get(key);
        if (!item) return [];
        placed.add(key);
        return [item];
      });
      if (!items.length) return [];
      const single = items.length === 1 ? items[0] : null;
      return [{
        id: page.id,
        items,
        label: single ? single.label : tr(`page_${page.id}_label`, page.label),
        description: single ? single.description : page.description ? tr(`page_${page.id}_desc`, page.description) : undefined,
        icon: single ? single.icon : page.icon,
      }];
    }),
  }));
  for (const item of visible.filter((i) => !placed.has(i.key))) {
    groups[1].pages.push({ id: item.key, items: [item], label: item.label, description: item.description, icon: item.icon });
  }
  return groups.filter((group) => group.pages.length > 0);
}
