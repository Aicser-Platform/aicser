import { SKU_CATALOG, skuForNavKey, skusForFeatures } from './skuCatalog';

describe('SKU catalog', () => {
  it('maps sidebar jobs onto Analyze / Ask / Govern / add-ons', () => {
    expect(skuForNavKey('dashboards')?.id).toBe('analyze');
    expect(skuForNavKey('chat')?.id).toBe('ask');
    expect(skuForNavKey('catalog')?.id).toBe('govern');
    expect(skuForNavKey('alerts')?.id).toBe('operate');
    expect(SKU_CATALOG.some((s) => s.id === 'industry')).toBe(true);
  });

  it('lists only SKUs the license features actually turn on', () => {
    expect(skusForFeatures(['audit_logs']).map((s) => s.id)).toEqual(['analyze', 'govern']);
    expect(skusForFeatures(['alerts', 'industry_packs']).map((s) => s.id)).toEqual([
      'analyze',
      'operate',
      'industry',
    ]);
  });
});
