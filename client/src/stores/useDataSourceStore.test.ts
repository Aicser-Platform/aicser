import { beforeEach, describe, expect, it } from 'vitest';
import { getStoredDataSourcePreference, useDataSourceStore } from './useDataSourceStore';

describe('the selected data source', () => {
  beforeEach(() => localStorage.clear());

  it('losing it is not the person clearing it', () => {
    useDataSourceStore.getState().select('ds1');
    useDataSourceStore.getState().dropSelection();
    expect(useDataSourceStore.getState().selectedId).toBeNull();
    expect(getStoredDataSourcePreference().explicitlyCleared).toBe(false);
  });

  it('clearing it on purpose is remembered', () => {
    useDataSourceStore.getState().select(null);
    expect(getStoredDataSourcePreference().explicitlyCleared).toBe(true);
  });
});
