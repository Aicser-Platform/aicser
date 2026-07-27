'use client';

import React, { useMemo, useState } from 'react';
import { Button, ColorPicker, Empty, Input, Segmented, Tabs, Upload, message } from 'antd';
import { ClearOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { WidgetIconRef } from './dashboardIconTypes';
import { normalizeWidgetIcon } from './dashboardIconTypes';
import {
  DASHBOARD_ICON_CATEGORIES,
  filterAntIcons,
  filterEmojiPresets,
} from './dashboardIconCatalog';
import { DashboardIcon } from './resolveDashboardIcon';
import { useBrandIconPack } from './useBrandIconPack';
import type { BrandIconPackItem } from './brandIconPack';
import type { WidgetIconCategory } from './dashboardIconTypes';
import './IconPicker.css';

const MAX_CUSTOM_BYTES = 512 * 1024; // 512KB for icon assets

export type IconPickerProps = {
  value?: unknown;
  legacyIconName?: unknown;
  onChange: (icon: WidgetIconRef | null) => void;
  /** Also clear legacy iconName when clearing */
  onClearLegacy?: () => void;
  size?: 'small' | 'middle';
  allowColor?: boolean;
};

export function IconPicker({
  value,
  legacyIconName,
  onChange,
  onClearLegacy,
  size = 'small',
  allowColor = true,
}: IconPickerProps) {
  const t = useTranslations('dashboards');
  const brandItems = useBrandIconPack();
  const current = normalizeWidgetIcon(value, legacyIconName);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<WidgetIconCategory | 'all'>('all');
  const [tab, setTab] = useState<string>(current?.set === 'brand' ? 'brand' : current?.set || 'antd');

  const antIcons = useMemo(() => filterAntIcons(query, category), [query, category]);
  const emojis = useMemo(() => filterEmojiPresets(query), [query]);
  const brands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return brandItems;
    return brandItems.filter((b) => `${b.key} ${b.label}`.toLowerCase().includes(q));
  }, [brandItems, query]);

  const select = (next: WidgetIconRef) => {
    onChange({
      ...next,
      color: next.color || current?.color,
    });
  };

  const clear = () => {
    onChange(null);
    onClearLegacy?.();
  };

  const handleCustomFile = (file: File) => {
    if (!file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      message.error(t('icon_custom_invalid'));
      return false;
    }
    if (file.size > MAX_CUSTOM_BYTES) {
      message.error(t('icon_custom_too_large'));
      return false;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result) select({ set: 'custom', name: result });
    };
    reader.onerror = () => message.error(t('icon_custom_failed'));
    reader.readAsDataURL(file);
    return false;
  };

  const preview = (
    <div className="icon-picker-preview">
      <div className="icon-picker-preview-glyph" aria-hidden>
        <DashboardIcon icon={current} brandItems={brandItems} size={22} />
      </div>
      <div className="icon-picker-preview-meta">
        <div className="icon-picker-preview-title">
          {current
            ? current.set === 'antd'
              ? current.name
              : current.set === 'emoji'
                ? t('icon_emoji_selected')
                : current.set === 'custom'
                  ? t('icon_custom_selected')
                  : t('icon_brand_selected')
            : t('icon_none')}
        </div>
        {allowColor && current && (current.set === 'antd' || current.set === 'brand') ? (
          <ColorPicker
            size="small"
            value={current.color || undefined}
            onChange={(c) => {
              if (!c) {
                onChange({ ...current, color: undefined });
                return;
              }
              onChange({ ...current, color: c.toHexString() });
            }}
            allowClear
          />
        ) : null}
      </div>
      <Button
        type="text"
        size="small"
        icon={<ClearOutlined />}
        disabled={!current}
        onClick={clear}
        aria-label={t('icon_clear')}
      />
    </div>
  );

  return (
    <div className={`icon-picker icon-picker--${size}`}>
      {preview}
      <Input
        size={size}
        allowClear
        prefix={<SearchOutlined />}
        placeholder={t('icon_search_placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="icon-picker-search"
      />
      <Tabs
        size="small"
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'antd',
            label: t('icon_tab_library'),
            children: (
              <div className="icon-picker-pane">
                <Segmented
                  size="small"
                  value={category}
                  onChange={(v) => setCategory(v as WidgetIconCategory | 'all')}
                  options={DASHBOARD_ICON_CATEGORIES.map((c) => ({
                    value: c.id,
                    label: t(c.labelKey),
                  }))}
                  className="icon-picker-categories"
                />
                <div className="icon-picker-grid">
                  {antIcons.map((entry) => {
                    const active = current?.set === 'antd' && current.name === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={`icon-picker-cell${active ? ' is-active' : ''}`}
                        title={entry.label}
                        onClick={() => select({ set: 'antd', name: entry.id })}
                      >
                        <DashboardIcon icon={{ set: 'antd', name: entry.id }} size={18} />
                      </button>
                    );
                  })}
                  {!antIcons.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('icon_empty')} /> : null}
                </div>
              </div>
            ),
          },
          {
            key: 'emoji',
            label: t('icon_tab_emoji'),
            children: (
              <div className="icon-picker-pane">
                <div className="icon-picker-grid icon-picker-grid--emoji">
                  {emojis.map((entry) => {
                    const active = current?.set === 'emoji' && current.name === entry.emoji;
                    return (
                      <button
                        key={entry.emoji}
                        type="button"
                        className={`icon-picker-cell${active ? ' is-active' : ''}`}
                        title={entry.label}
                        onClick={() => select({ set: 'emoji', name: entry.emoji })}
                      >
                        <span style={{ fontSize: 18, lineHeight: 1 }}>{entry.emoji}</span>
                      </button>
                    );
                  })}
                  {!emojis.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('icon_empty')} /> : null}
                </div>
                <Input
                  size={size}
                  placeholder={t('icon_emoji_custom_placeholder')}
                  onPressEnter={(e) => {
                    const raw = (e.target as HTMLInputElement).value.trim();
                    if (raw) select({ set: 'emoji', name: raw });
                  }}
                  allowClear
                />
              </div>
            ),
          },
          {
            key: 'custom',
            label: t('icon_tab_custom'),
            children: (
              <div className="icon-picker-pane">
                <Upload.Dragger
                  accept="image/*,.svg"
                  showUploadList={false}
                  beforeUpload={handleCustomFile}
                  className="icon-picker-dragger"
                >
                  <p>
                    <UploadOutlined /> {t('icon_custom_drop')}
                  </p>
                  <p className="icon-picker-hint">{t('icon_custom_limit')}</p>
                </Upload.Dragger>
                <Input
                  size={size}
                  placeholder={t('icon_custom_url_placeholder')}
                  onPressEnter={(e) => {
                    const raw = (e.target as HTMLInputElement).value.trim();
                    if (!raw) return;
                    if (!/^https?:\/\//i.test(raw) && !/^data:image\//i.test(raw)) {
                      message.error(t('icon_custom_url_invalid'));
                      return;
                    }
                    select({ set: 'custom', name: raw });
                  }}
                  allowClear
                />
              </div>
            ),
          },
          {
            key: 'brand',
            label: t('icon_tab_brand'),
            children: (
              <div className="icon-picker-pane">
                {!brands.length ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t('icon_brand_empty')}
                  />
                ) : (
                  <div className="icon-picker-brand-list">
                    {brands.map((item: BrandIconPackItem) => {
                      const active = current?.set === 'brand' && current.name === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`icon-picker-brand-row${active ? ' is-active' : ''}`}
                          onClick={() =>
                            select({
                              set: 'brand',
                              name: item.key,
                              color: item.color,
                            })
                          }
                        >
                          <span className="icon-picker-brand-glyph">
                            <DashboardIcon
                              icon={{ set: 'brand', name: item.key, color: item.color }}
                              brandItems={brandItems}
                              size={18}
                            />
                          </span>
                          <span className="icon-picker-brand-label">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export default IconPicker;
