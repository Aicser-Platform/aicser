'use client';

import React, { useMemo, useState } from 'react';
import { Button, Tooltip, Typography } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import {
  buildWidgetSections,
  type WidgetTemplate,
  WIDGET_TEMPLATES,
} from '../widgetTemplates';
import {
  FEATURED_WIDGET_TYPES,
  localizeWidgetTemplate,
} from '../utils/localizeWidgetTemplate';
import './WidgetBlockPicker.css';

const { Text } = Typography;

const SECTION_TITLE_KEYS: Record<string, string> = {
  Charts: 'block_section_charts',
  Indicators: 'block_section_indicators',
  Data: 'block_section_data',
  Content: 'block_section_content',
};

function sectionLabel(title: string, t: (key: string) => string): string {
  const key = SECTION_TITLE_KEYS[title];
  return key ? t(key) : title;
}

export type WidgetBlockPickerVariant = 'canvas' | 'popover';

type Props = {
  variant?: WidgetBlockPickerVariant;
  onSelect: (template: WidgetTemplate) => void;
  search?: string;
  hintText?: string;
};

function BlockTooltipContent({
  name,
  description,
  bestFor,
  bestForLabel,
}: {
  name: string;
  description: string;
  bestFor?: string;
  bestForLabel: string;
}) {
  return (
    <div className="widget-block-tooltip">
      <div className="widget-block-tooltip-title">{name}</div>
      <div className="widget-block-tooltip-desc">{description}</div>
      {bestFor ? (
        <div className="widget-block-tooltip-best">
          <span className="widget-block-tooltip-best-label">{bestForLabel}</span> {bestFor}
        </div>
      ) : null}
    </div>
  );
}

function WidgetBlockTile({
  item,
  variant,
  onSelect,
  bestForLabel,
}: {
  item: WidgetTemplate & { bestFor?: string };
  variant: WidgetBlockPickerVariant;
  onSelect: (template: WidgetTemplate) => void;
  bestForLabel: string;
}) {
  return (
    <Tooltip
      title={
        <BlockTooltipContent
          name={item.name}
          description={item.description}
          bestFor={item.bestFor}
          bestForLabel={bestForLabel}
        />
      }
      placement={variant === 'popover' ? 'right' : 'top'}
      mouseEnterDelay={0.35}
    >
      <button
        type="button"
        className={`widget-block-tile widget-block-tile--${variant}`}
        onClick={() => onSelect(item)}
        aria-label={item.name}
      >
        <span className="widget-block-tile-icon">{item.icon}</span>
        <span className="widget-block-tile-name">{item.name}</span>
      </button>
    </Tooltip>
  );
}

export function WidgetBlockPicker({ variant = 'canvas', onSelect, search = '', hintText }: Props) {
  const t = useTranslations('dashboards_page');
  const tc = useTranslations('chart_designer');
  const [expanded, setExpanded] = useState(false);

  const normalizedSearch = search.trim().toLowerCase();

  const allTemplates = useMemo(
    () => WIDGET_TEMPLATES.map((item) => localizeWidgetTemplate(item, tc as never)),
    [tc],
  );

  const featuredTemplates = useMemo(() => {
    const byType = new Map(allTemplates.map((item) => [item.type, item]));
    return FEATURED_WIDGET_TYPES.map((type) => byType.get(type)).filter(Boolean) as Array<
      WidgetTemplate & { bestFor?: string }
    >;
  }, [allTemplates]);

  const sections = useMemo(() => buildWidgetSections(allTemplates), [allTemplates]);

  const filteredSections = useMemo(() => {
    if (!normalizedSearch) return sections;
    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.name.toLowerCase().includes(normalizedSearch) ||
            item.description.toLowerCase().includes(normalizedSearch) ||
            item.type.toLowerCase().includes(normalizedSearch),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [sections, normalizedSearch]);

  const filteredFeatured = useMemo(() => {
    if (!normalizedSearch) return featuredTemplates;
    return featuredTemplates.filter(
      (item) =>
        item.name.toLowerCase().includes(normalizedSearch) ||
        item.description.toLowerCase().includes(normalizedSearch) ||
        item.type.toLowerCase().includes(normalizedSearch),
    );
  }, [featuredTemplates, normalizedSearch]);

  const showExpanded = expanded || Boolean(normalizedSearch);
  const bestForLabel = t('block_best_for');

  if (variant === 'popover') {
    const showFeaturedOnly = !normalizedSearch && !showExpanded;

    return (
      <div className="widget-block-picker widget-block-picker--popover">
        {showFeaturedOnly && filteredFeatured.length > 0 && (
          <>
            <div className="widget-block-picker-section-label">{t('blocks_featured')}</div>
            <div className="widget-block-grid widget-block-grid--popover">
              {filteredFeatured.map((item) => (
                <WidgetBlockTile
                  key={item.id}
                  item={item}
                  variant={variant}
                  onSelect={onSelect}
                  bestForLabel={bestForLabel}
                />
              ))}
            </div>
            <Button
              type="link"
              size="small"
              className="widget-block-more-btn"
              icon={<DownOutlined />}
              onClick={() => setExpanded(true)}
            >
              {t('blocks_show_all')}
            </Button>
          </>
        )}

        {(showExpanded || normalizedSearch) &&
          filteredSections.map((section) => (
            <div key={section.title} className="widget-block-section">
              <div className="widget-block-picker-section-label">
                {sectionLabel(section.title, t)}
              </div>
              <div className="widget-block-grid widget-block-grid--popover">
                {section.items.map((item) => (
                  <WidgetBlockTile
                    key={item.id}
                    item={item as WidgetTemplate & { bestFor?: string }}
                    variant={variant}
                    onSelect={onSelect}
                    bestForLabel={bestForLabel}
                  />
                ))}
              </div>
            </div>
          ))}

        {!normalizedSearch && showExpanded ? (
          <Button
            type="link"
            size="small"
            className="widget-block-more-btn"
            icon={<UpOutlined />}
            onClick={() => setExpanded(false)}
          >
            {t('blocks_show_less')}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="widget-block-picker widget-block-picker--canvas">
      <Text type="secondary" className="widget-block-picker-hint">
        {hintText ?? t('empty_state_hint')}
      </Text>

      <div className="widget-block-picker-section-label">{t('blocks_featured')}</div>
      <div className="widget-block-grid widget-block-grid--canvas">
        {filteredFeatured.map((item) => (
          <WidgetBlockTile
            key={item.id}
            item={item}
            variant={variant}
            onSelect={onSelect}
            bestForLabel={bestForLabel}
          />
        ))}
      </div>

      {!normalizedSearch && !showExpanded ? (
        <div className="widget-block-more-wrap">
          <Button type="default" icon={<DownOutlined />} onClick={() => setExpanded(true)}>
            {t('blocks_show_all')}
          </Button>
        </div>
      ) : null}

      {showExpanded &&
        filteredSections.map((section) => (
          <div key={section.title} className="widget-block-section">
            <div className="widget-block-picker-section-label">
              {sectionLabel(section.title, t)}
            </div>
            <div className="widget-block-grid widget-block-grid--canvas-expanded">
              {section.items.map((item) => (
                <WidgetBlockTile
                  key={item.id}
                  item={item as WidgetTemplate & { bestFor?: string }}
                  variant={variant}
                  onSelect={onSelect}
                  bestForLabel={bestForLabel}
                />
              ))}
            </div>
          </div>
        ))}

      {!normalizedSearch && showExpanded ? (
        <div className="widget-block-more-wrap">
          <Button type="link" icon={<UpOutlined />} onClick={() => setExpanded(false)}>
            {t('blocks_show_less')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default WidgetBlockPicker;
