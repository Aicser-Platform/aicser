import { describe, expect, it } from 'vitest';
import { folderAndDescendants, folderTree, type Folder } from '@/services/folderService';
import { inFolderView } from '@/components/assets/Folders';

const f = (id: string, parent: string | null = null): Folder => ({ id, name: id.toUpperCase(), parent_id: parent, sort_order: 0 });
const FOLDERS = [f('finance'), f('q3', 'finance'), f('board', 'q3'), f('ops'), f('stray', 'gone')];

describe('project folders', () => {
  it('builds the tree; a folder whose parent is missing shows at the top', () => {
    const tree = folderTree(FOLDERS);
    expect(tree.map((n) => n.value)).toEqual(['finance', 'ops', 'stray']);
    expect(tree[0].children?.[0].value).toBe('q3');
    expect(tree[0].children?.[0].children?.[0].value).toBe('board');
  });

  it('a folder includes everything under it', () => {
    expect([...folderAndDescendants(FOLDERS, 'finance')].sort()).toEqual(['board', 'finance', 'q3']);
    expect([...folderAndDescendants(FOLDERS, 'ops')]).toEqual(['ops']);
  });

  it('filters items by folder view', () => {
    const items = [{ id: 'a', folder_id: 'board' }, { id: 'b', folder_id: 'ops' }, { id: 'c', folder_id: null }];
    expect(inFolderView(items, 'all', FOLDERS).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(inFolderView(items, 'unfiled', FOLDERS).map((x) => x.id)).toEqual(['c']);
    expect(inFolderView(items, 'finance', FOLDERS).map((x) => x.id)).toEqual(['a']);
  });
});
