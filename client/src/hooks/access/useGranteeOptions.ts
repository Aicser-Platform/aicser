import { useEffect, useMemo, useState } from 'react';

import type { DataSourceGrantGranteeType } from '@/api/dataSources';
import type { OrganizationMember } from '@/api/organizations';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { useProjects } from '@/hooks/useProjects';
import { useRoleStore } from '@/stores/useRoleStore';
import type { Project } from '@/types/project';
import type { Role } from '@/types/roles';
import { fetchApi } from '@/utils/api';
import { isEnterpriseEdition } from '@/utils/appPaths';

export type SupportedGranteeType = DataSourceGrantGranteeType;

/** Directory (identity-provider) group, EE only — see Settings → Identity. */
export type DirectoryGroup = { id: string; name: string; members: number };

export type GranteeOption = {
  value: string;
  label: string;
  description?: string;
  /** Rendered under the label — disambiguates people who share a display name. */
  secondary?: string;
  type: SupportedGranteeType;
};

export const encodeGranteeValue = (type: SupportedGranteeType, id: string): string => `${type}:${id}`;

/** Split on the FIRST colon only — grantee ids may themselves contain colons. */
export const decodeGranteeValue = (value: string): { type: SupportedGranteeType; id: string } => {
  const separator = value.indexOf(':');
  return {
    type: value.slice(0, separator) as SupportedGranteeType,
    id: value.slice(separator + 1),
  };
};

export const GRANTEE_TYPES: SupportedGranteeType[] = ['project', 'user', 'group', 'org_role', 'project_role'];

const roleLabel = (role: Role) => role.display_name || role.name || role.id;

const memberDisplayName = (member: OrganizationMember): string =>
  [member.first_name, member.last_name].filter(Boolean).join(' ').trim();

export const toGranteeOptions = (
  granteeType: SupportedGranteeType,
  data: {
    projects: Project[];
    members: OrganizationMember[];
    orgRoles: Role[];
    projectRoles: Role[];
    groups?: DirectoryGroup[];
  }
): GranteeOption[] => {
  if (granteeType === 'group') {
    return (data.groups || []).map((group) => ({
      value: group.id,
      label: group.name,
      secondary: String(group.members),
      type: granteeType,
    }));
  }

  if (granteeType === 'project') {
    return data.projects.map((project) => ({
      value: String(project.id),
      label: project.name || String(project.id),
      description: project.description || undefined,
      type: granteeType,
    }));
  }

  if (granteeType === 'user') {
    const seen = new Set<string>();
    return data.members.reduce<GranteeOption[]>((options, member) => {
      const id = String(member.user_id);
      if (seen.has(id)) return options;
      seen.add(id);

      const name = memberDisplayName(member);
      const label = name || member.email || member.username || id;
      options.push({
        value: id,
        label,
        secondary: name && member.email ? member.email : undefined,
        type: granteeType,
      });
      return options;
    }, []);
  }

  if (granteeType === 'org_role') {
    return data.orgRoles.map((role) => ({
      value: role.id,
      label: roleLabel(role),
      description: role.description || undefined,
      type: granteeType,
    }));
  }

  return data.projectRoles.map((role) => ({
    value: role.id,
    label: roleLabel(role),
    description: role.description || undefined,
    type: granteeType,
  }));
};

export const useGranteeOptions = (
  granteeType: SupportedGranteeType,
  {
    organizationId,
    enabled = true,
  }: {
    organizationId?: string | null;
    enabled?: boolean;
  }
) => {
  const { optionsByType, isLoadingByType } = useGranteeDirectory({ organizationId, enabled });

  return {
    options: optionsByType[granteeType],
    isLoading: isLoadingByType[granteeType],
  };
};

export const useGranteeDirectory = ({
  organizationId,
  enabled = true,
}: {
  organizationId?: string | null;
  enabled?: boolean;
}) => {
  const { projects, isLoading: projectsLoading } = useProjects(enabled ? organizationId : null);
  const { members, isLoading: membersLoading } = useOrganizationMembers(organizationId, enabled);
  const { orgRoles, projectRoles, loading: rolesLoading, fetchOrgRoles, fetchProjectRoles } = useRoleStore();

  const [groups, setGroups] = useState<DirectoryGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    void fetchOrgRoles();
    void fetchProjectRoles();
  }, [enabled, fetchOrgRoles, fetchProjectRoles]);

  useEffect(() => {
    if (!enabled || !organizationId || !isEnterpriseEdition()) return;
    let cancelled = false;
    setGroupsLoading(true);
    fetchApi<{ groups?: DirectoryGroup[] }>('api/scim/groups')
      .then((res) => {
        if (!cancelled) setGroups(Array.isArray(res?.groups) ? res.groups : []);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, organizationId]);

  const optionsByType = useMemo(() => {
    const data = { projects, members, orgRoles, projectRoles, groups };
    return {
      project: toGranteeOptions('project', data),
      user: toGranteeOptions('user', data),
      group: toGranteeOptions('group', data),
      org_role: toGranteeOptions('org_role', data),
      project_role: toGranteeOptions('project_role', data),
    };
  }, [groups, members, orgRoles, projectRoles, projects]);

  const flatOptions = useMemo(
    () => GRANTEE_TYPES.flatMap((type) => optionsByType[type]),
    [optionsByType]
  );

  const isLoadingByType = {
    project: projectsLoading,
    user: membersLoading,
    group: groupsLoading,
    org_role: rolesLoading,
    project_role: rolesLoading,
  };

  return { optionsByType, isLoadingByType, flatOptions };
};
