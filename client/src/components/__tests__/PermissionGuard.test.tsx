import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const usePermissions = vi.fn();
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: (opts: unknown) => usePermissions(opts) }));
vi.mock('@/stores/useOrganizationStore', () => ({
  useOrganizationStore: (sel: (s: unknown) => unknown) => sel({ currentOrganization: { id: 'org-1' } }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import { PermissionGuard } from '../PermissionGuard';
import { Permission } from '@/constants/permissions';

const state = (over: Partial<Record<string, unknown>>) => ({
  hasPermission: () => false, hasAnyPermission: () => false, hasAllPermissions: () => false, loading: false, ...over,
});

describe('PermissionGuard', () => {
  beforeEach(() => usePermissions.mockReset());

  it('checks permissions in the current organization when none is given', () => {
    usePermissions.mockReturnValue(state({ hasAnyPermission: () => true }));
    render(<PermissionGuard permission={[Permission.ORG_EDIT]} fallback={<span>denied</span>}><span>ok</span></PermissionGuard>);
    expect(usePermissions).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1' }));
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('shows nothing while checking, not a denial', () => {
    usePermissions.mockReturnValue(state({ loading: true }));
    render(<PermissionGuard permission={Permission.ORG_EDIT} fallback={<span>denied</span>}><span>ok</span></PermissionGuard>);
    expect(screen.queryByText('denied')).not.toBeInTheDocument();
    expect(screen.queryByText('ok')).not.toBeInTheDocument();
  });

  it('still denies once the check says no', () => {
    usePermissions.mockReturnValue(state({}));
    render(<PermissionGuard permission={Permission.ORG_EDIT} fallback={<span>denied</span>}><span>ok</span></PermissionGuard>);
    expect(screen.getByText('denied')).toBeInTheDocument();
  });
});
