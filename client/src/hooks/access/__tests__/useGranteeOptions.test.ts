import { describe, expect, it } from 'vitest';

import type { OrganizationMember } from '@/api/organizations';
import type { Project } from '@/types/project';
import type { Role } from '@/types/roles';
import {
  GRANTEE_TYPES,
  decodeGranteeValue,
  encodeGranteeValue,
  toGranteeOptions,
} from '../useGranteeOptions';

describe('data source grantee options', () => {
  const project = {
    id: 'project-1',
    name: 'Finance Analytics',
    description: 'Finance workspace',
  } as Project;

  const member: OrganizationMember = {
    user_id: 'user-1',
    email: 'analyst@example.com',
    username: 'analyst',
  };

  const orgRole = {
    id: 'role-org-admin',
    name: 'org_admin',
    display_name: 'Org Admin',
    scope: 'organization',
  } as Role;

  const projectRole = {
    id: 'role-project-viewer',
    name: 'project_viewer',
    display_name: 'Project Viewer',
    scope: 'project',
  } as Role;

  const directory = {
    projects: [project],
    members: [member],
    orgRoles: [orgRole],
    projectRoles: [projectRole],
  };

  it('uses concrete object names instead of exposing raw IDs', () => {
    expect(toGranteeOptions('project', directory)).toEqual([
      {
        value: 'project-1',
        label: 'Finance Analytics',
        description: 'Finance workspace',
        type: 'project',
      },
    ]);
    expect(toGranteeOptions('user', directory)[0]).toMatchObject({
      value: 'user-1',
      label: 'analyst@example.com',
    });
    expect(toGranteeOptions('user', directory)[0].secondary).toBeUndefined();
    expect(toGranteeOptions('org_role', directory)[0]).toMatchObject({
      value: 'role-org-admin',
      label: 'Org Admin',
    });
    expect(toGranteeOptions('project_role', directory)[0]).toMatchObject({
      value: 'role-project-viewer',
      label: 'Project Viewer',
    });
  });

  it('keeps unsupported group grants out of the create picker', () => {
    expect(GRANTEE_TYPES).toEqual(['project', 'user', 'org_role', 'project_role']);
  });
  it('tags every option with its grantee type so one Select can list all four', () => {
    expect(toGranteeOptions('project', directory)[0].type).toBe('project');
    expect(toGranteeOptions('user', directory)[0].type).toBe('user');
    expect(toGranteeOptions('org_role', directory)[0].type).toBe('org_role');
    expect(toGranteeOptions('project_role', directory)[0].type).toBe('project_role');
  });

  it('round-trips a grantee value through encode/decode', () => {
    expect(encodeGranteeValue('project', 'project-1')).toBe('project:project-1');
    expect(decodeGranteeValue('project:project-1')).toEqual({ type: 'project', id: 'project-1' });
  });

  it('keeps ids containing colons intact when decoding', () => {
    expect(decodeGranteeValue('user:a:b:c')).toEqual({ type: 'user', id: 'a:b:c' });
  });
});

describe('toGranteeOptions user dedupe', () => {
  it('emits one option per user even when the API repeats them', () => {
    // The members endpoint joined roles onto members, so a user with several
    // roles arrived several times. Guard the client side too.
    const members = [
      { user_id: 'u1', email: 'a@example.com', first_name: 'A', last_name: 'B' },
      { user_id: 'u1', email: 'a@example.com', first_name: 'A', last_name: 'B' },
      { user_id: 'u2', email: 'c@example.com', first_name: 'C', last_name: 'D' },
    ] as OrganizationMember[];

    const options = toGranteeOptions('user', { projects: [], members, orgRoles: [], projectRoles: [] });

    expect(options).toHaveLength(2);
    expect(options.map((option) => option.value)).toEqual(['u1', 'u2']);
  });

  it('puts the display name on the label and the email underneath', () => {
    const members = [
      { user_id: 'u1', email: 'a@example.com', first_name: 'Ada', last_name: 'Lovelace' },
    ] as OrganizationMember[];

    const [option] = toGranteeOptions('user', { projects: [], members, orgRoles: [], projectRoles: [] });

    expect(option.label).toBe('Ada Lovelace');
    expect(option.secondary).toBe('a@example.com');
  });

  it('falls back to the email as the label when there is no name', () => {
    const members = [{ user_id: 'u1', email: 'a@example.com' }] as OrganizationMember[];
    const [option] = toGranteeOptions('user', { projects: [], members, orgRoles: [], projectRoles: [] });

    expect(option.label).toBe('a@example.com');
    expect(option.secondary).toBeUndefined();
  });
});
