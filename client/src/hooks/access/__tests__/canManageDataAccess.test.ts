import { describe, expect, it } from 'vitest';
import { Permission } from '@/constants/permissions';
import {
  DATA_ADMIN_PERMISSIONS,
  computeCanManageDataAccess,
} from '../useCanManageDataAccess';

describe('computeCanManageDataAccess', () => {
  it('mirrors the server’s _is_org_data_admin permission set', () => {
    // server: ("data:*", "data:delete", "data:edit", "data:connect")
    expect(DATA_ADMIN_PERMISSIONS).toEqual([
      Permission.DATA_DELETE,
      Permission.DATA_EDIT,
      Permission.DATA_CONNECT,
    ]);
  });

  it('allows anyone holding any one of those permissions', () => {
    for (const permission of DATA_ADMIN_PERMISSIONS) {
      expect(computeCanManageDataAccess([permission], { isEnterprise: true, loading: false })).toBe(true);
    }
  });

  it('refuses a user with only read or upload rights', () => {
    expect(
      computeCanManageDataAccess([Permission.DATA_VIEW, Permission.DATA_UPLOAD], {
        isEnterprise: true,
        loading: false,
      })
    ).toBe(false);
  });

  it('stays false in CE, where grants and policies do not exist', () => {
    expect(
      computeCanManageDataAccess([Permission.DATA_DELETE], { isEnterprise: false, loading: false })
    ).toBe(false);
  });

  it('stays false while permissions are still loading, so the action never flickers in', () => {
    expect(
      computeCanManageDataAccess([Permission.DATA_DELETE], { isEnterprise: true, loading: true })
    ).toBe(false);
  });

  it('refuses a user with no permissions at all', () => {
    expect(computeCanManageDataAccess([], { isEnterprise: true, loading: false })).toBe(false);
  });
});
