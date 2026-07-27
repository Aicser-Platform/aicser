import { describe, expect, it } from 'vitest';
import { isWidgetIconRef, normalizeWidgetIcon } from './dashboardIconTypes';
import { buildBrandIconPack } from './brandIconPack';

describe('normalizeWidgetIcon', () => {
  it('accepts structured refs', () => {
    expect(normalizeWidgetIcon({ set: 'antd', name: 'DollarOutlined', color: '#0f0' })).toEqual({
      set: 'antd',
      name: 'DollarOutlined',
      color: '#0f0',
    });
    expect(isWidgetIconRef({ set: 'emoji', name: '📈' })).toBe(true);
  });

  it('maps legacy iconName strings', () => {
    expect(normalizeWidgetIcon(undefined, 'RiseOutlined')).toEqual({
      set: 'antd',
      name: 'RiseOutlined',
    });
    expect(normalizeWidgetIcon(undefined, '🚀')?.set).toBe('emoji');
    expect(normalizeWidgetIcon(undefined, 'https://cdn.example/logo.png')).toEqual({
      set: 'custom',
      name: 'https://cdn.example/logo.png',
    });
    expect(normalizeWidgetIcon(undefined, 'data:image/png;base64,abc')).toEqual({
      set: 'custom',
      name: 'data:image/png;base64,abc',
    });
  });

  it('returns null when empty', () => {
    expect(normalizeWidgetIcon(undefined, undefined)).toBeNull();
    expect(normalizeWidgetIcon({}, '')).toBeNull();
  });
});

describe('buildBrandIconPack', () => {
  it('returns empty without org', () => {
    expect(buildBrandIconPack(null)).toEqual([]);
  });

  it('builds logo, emoji, and accent icons from org', () => {
    const pack = buildBrandIconPack({
      id: '1',
      name: 'Acme',
      created_at: '',
      is_active: true,
      is_deleted: false,
      telegram_enabled: false,
      logo_url: 'https://cdn.example/acme.png',
      icon_emoji: '🏢',
      color: '#336699',
    });
    expect(pack.some((i) => i.key === 'logo' && i.kind === 'image')).toBe(true);
    expect(pack.some((i) => i.key === 'emoji' && i.value === '🏢')).toBe(true);
    expect(pack.filter((i) => i.kind === 'antd').length).toBeGreaterThanOrEqual(3);
    expect(pack.find((i) => i.key === 'accent-dashboard')?.color).toBe('#336699');
  });
});
