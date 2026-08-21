import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';

const mockRouter = { push: vi.fn(), replace: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({}),
}));

vi.mock('@/hooks/useDataSources', () => ({
  useDataSourceRLSPolicies: () => ({ policies: [], isLoading: false, isFetching: false }),
  useDataSourceSchema: () => ({ schema: null, isLoading: false }),
  useDataSourceRLSProjectAttributes: () => ({ attributes: [], isLoading: false, isFetching: false }),
  useCreateDataSourceRLSPolicy: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useUpdateDataSourceRLSPolicy: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  usePreviewDataSourceRLSPolicy: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useUpdateDataSourceRLSProjectAttribute: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
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

import PolicyEditorPage from '../_components/policy/PolicyEditorPage';

const renderPage = (props: { dataSourceId: string; policyId?: string }) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
      <PolicyEditorPage {...props} />
    </NextIntlClientProvider>
  );

describe('PolicyEditorPage', () => {
  it(
    'warns before discarding unsaved edits',
    async () => {
      renderPage({ dataSourceId: 'ds-1' });

      fireEvent.change(screen.getByLabelText(/policy name/i), { target: { value: 'Customer ID' } });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

      // rc-motion's transition-based mount can be slow under a fully loaded
      // test run (many suites competing for the event loop), so this uses a
      // generous find timeout rather than the RTL default.
      expect((await screen.findAllByText(/unsaved changes/i, {}, { timeout: 8000 })).length).toBeGreaterThan(0);
      expect(mockRouter.push).not.toHaveBeenCalled();
    },
    15000
  );

  it('leaves without warning when nothing was edited', async () => {
    mockRouter.push.mockClear();
    renderPage({ dataSourceId: 'ds-1' });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(mockRouter.push).toHaveBeenCalledWith('/data/sources/ds-1?tab=row-filters');
  });
});
