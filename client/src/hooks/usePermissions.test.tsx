import { describe, it, expect } from 'vitest';
import { Permission } from './usePermissions';

describe('Permission enum', () => {
  it('includes knowledge permissions', () => {
    expect(Permission.KNOWLEDGE_VIEW).toBe('knowledge:view');
    expect(Permission.KNOWLEDGE_CREATE).toBe('knowledge:create');
    expect(Permission.KNOWLEDGE_SEARCH).toBe('knowledge:search');
  });

  it('includes embed and audit permissions', () => {
    expect(Permission.EMBED_CREATE).toBe('embed:create');
    expect(Permission.EMBED_VIEW).toBe('embed:view');
    expect(Permission.AUDIT_VIEW).toBe('audit:view');
  });

  it('includes dashboard create permission', () => {
    expect(Permission.DASHBOARD_CREATE).toBe('dashboard:create');
  });

  it('includes agent permissions', () => {
    expect(Permission.AGENT_USE).toBe('agent:use');
    expect(Permission.AGENT_CONFIGURE).toBe('agent:configure');
  });
});
