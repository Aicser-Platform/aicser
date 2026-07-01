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
    <div className="max-w-[260px] text-xs leading-relaxed">
      <div className="font-semibold mb-1">{name}</div>
      <div className="opacity-90">{description}</div>
      {bestFor ? (
        <div className="mt-1.5 opacity-90 text-[11px]">
          <span className="font-semibold">{bestForLabel}</span> {bestFor}
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
        className={
          variant === 'popover'
            ? 'flex flex-col items-center justify-center gap-1.5 w-full min-h-[58px] px-0.5 py-1.5 rounded-md text-inherit transition-colors hover:bg-brand-subtle focus-visible:bg-brand-subtle focus-visible:outline-none'
            : 'flex flex-col items-center justify-center gap-1.5 w-full min-h-[88px] px-2 py-3 rounded-md border border-border-light bg-bg-container text-inherit transition-colors hover:border-brand hover:bg-brand-subtle focus-visible:border-brand focus-visible:bg-brand-subtle focus-visible:outline-none'
        }
        onClick={() => onSelect(item)}
        aria-label={item.name}
      >
        <span className={`flex items-center justify-center leading-none text-brand ${variant === 'popover' ? 'text-lg' : 'text-[22px]'}`}>
          {item.icon}
        </span>
        <span
          className={`block max-w-full truncate text-center leading-tight ${
            variant === 'popover' ? 'text-[10px] font-medium text-text-secondary' : 'text-xs font-semibold text-text'
          }`}
        >
          {item.name}
        </span>
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
      <div>
        {showFeaturedOnly && filteredFeatured.length > 0 && (
          <>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mx-2.5 mt-2 mb-1.5 text-left">{t('blocks_featured')}</div>
            <div className="grid grid-cols-4 gap-0.5 px-1.5 pb-1">
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
              className="block mx-auto mt-0.5 mb-1 text-[11px] px-2.5"
              icon={<DownOutlined />}
              onClick={() => setExpanded(true)}
            >
              {t('blocks_show_all')}
            </Button>
          </>
        )}

        {(showExpanded || normalizedSearch) &&
          filteredSections.map((section) => (
            <div key={section.title} className="mt-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mx-2.5 mt-2 mb-1.5 text-left">
                {sectionLabel(section.title, t)}
              </div>
              <div className="grid grid-cols-4 gap-0.5 px-1.5 pb-1">
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
            className="block mx-auto mt-0.5 mb-1 text-[11px] px-2.5"
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
    <div className="w-full max-w-[720px] mx-auto text-center">
      <Text type="secondary" className="!block !mb-5 text-base opacity-85">
        {hintText ?? t('empty_state_hint')}
      </Text>

      <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mx-2.5 mt-0 mb-1.5 text-center">{t('blocks_featured')}</div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
        <div className="mt-4">
          <Button type="default" icon={<DownOutlined />} onClick={() => setExpanded(true)}>
            {t('blocks_show_all')}
          </Button>
        </div>
      ) : null}

      {showExpanded &&
        filteredSections.map((section) => (
          <div key={section.title} className="mt-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mx-2.5 mt-2 mb-1.5 text-left">
              {sectionLabel(section.title, t)}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 text-left">
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
        <div className="mt-4">
          <Button type="link" icon={<UpOutlined />} onClick={() => setExpanded(false)}>
            {t('blocks_show_less')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default WidgetBlockPicker;
