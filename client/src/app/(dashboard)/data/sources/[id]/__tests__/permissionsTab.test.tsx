import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/hooks/dataSourceKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/dataSourceKeys')>()),
  isEnterpriseEdition: false,
}));
vi.mock('@/hooks/useDataSources', () => ({
  useDataSourceAccessGrants: () => ({ grants: [], isLoading: false, isFetching: false }),
  useDataSourceRLSPolicies: () => ({ policies: [], isLoading: false, isFetching: false }),
  useUpsertDataSourceAccessGrant: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeDataSourceAccessGrant: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/access/useGranteeOptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/access/useGranteeOptions')>()),
  useGranteeDirectory: () => ({
    optionsByType: { project: [], user: [], org_role: [], project_role: [] },
    isLoadingByType: { project: false, user: false, org_role: false, project_role: false },
    flatOptions: [],
  }),
}));
vi.mock('@/stores/useOrganizationStore', () => ({
  useOrganizationStore: (selector: (state: unknown) => unknown) =>
    selector({ currentOrganization: { id: 'org-1' } }),
}));

import DataSourcePermissionsTab from '../_components/DataSourcePermissionsTab';

describe('DataSourcePermissionsTab in CE', () => {
  it('shows the enterprise-only empty state instead of the share bar', () => {
    render(<DataSourcePermissionsTab dataSourceId="ds1" active />);
    expect(screen.getByText('data_source_access_ee_only')).toBeInTheDocument();
    expect(screen.queryByText('share_submit')).not.toBeInTheDocument();
  });
});
