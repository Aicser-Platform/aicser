import { useEffect, useMemo } from 'react';

import type { DataSourceGrantGranteeType } from '@/api/dataSources';
import type { OrganizationMember } from '@/api/organizations';
import { useOrganizationMembers } from '@/hooks/useOrganizationMembers';
import { useProjects } from '@/hooks/useProjects';
import { useRoleStore } from '@/stores/useRoleStore';
import type { Project } from '@/types/project';
import type { Role } from '@/types/roles';

export type SupportedGranteeType = Exclude<DataSourceGrantGranteeType, 'group'>;

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

export const GRANTEE_TYPES: SupportedGranteeType[] = ['project', 'user', 'org_role', 'project_role'];

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
  }
): GranteeOption[] => {
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

  useEffect(() => {
    if (!enabled) return;
    void fetchOrgRoles();
    void fetchProjectRoles();
  }, [enabled, fetchOrgRoles, fetchProjectRoles]);

  const optionsByType = useMemo(
    () => ({
      project: toGranteeOptions('project', { projects, members, orgRoles, projectRoles }),
      user: toGranteeOptions('user', { projects, members, orgRoles, projectRoles }),
      org_role: toGranteeOptions('org_role', { projects, members, orgRoles, projectRoles }),
      project_role: toGranteeOptions('project_role', { projects, members, orgRoles, projectRoles }),
    }),
    [members, orgRoles, projectRoles, projects]
  );

  const flatOptions = useMemo(
    () => GRANTEE_TYPES.flatMap((type) => optionsByType[type]),
    [optionsByType]
  );

  const isLoadingByType = {
    project: projectsLoading,
    user: membersLoading,
    org_role: rolesLoading,
    project_role: rolesLoading,
  };

  return { optionsByType, isLoadingByType, flatOptions };
};
