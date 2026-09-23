import { expect, test } from '@playwright/test';

test.describe('Catalog Explorer', () => {
  test('loads the tree, selects an asset, and shows its tabs and pipeline panel', async ({ page }) => {
    await page.goto('/catalog');

    await expect(page.getByRole('heading', { level: 2 })).toBeVisible();

    const tree = page.locator('.ant-tree');
    await expect(tree).toBeVisible();

    const firstLeaf = tree.locator('.ant-tree-treenode').first();
    await firstLeaf.click();

    const tabs = page.locator('.ant-tabs');
    await expect(tabs).toBeVisible();

    await expect(page.getByText('Medallion Flow & Pipeline')).toBeVisible();
  });
});
