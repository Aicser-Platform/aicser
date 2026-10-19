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
import { STORY_STARTERS, type StoryStarterId } from '../utils/storyStarters';
import Link from 'next/link';
import { endCanvasDrag, startCanvasDrag } from '../utils/canvasDrag';

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
  /** Dashboard Studio empty canvas — multi-widget story scaffolds. */
  onApplyStoryStarter?: (id: StoryStarterId) => void;
  search?: string;
  hintText?: string;
  /** Heading above the canvas picker; `null` hides it (the host page has its own). */
  title?: string | null;
  /** A standalone chart (Chart library): visuals, indicators and tables only, all shown at once —
   * no text, image or filter blocks, which only make sense on a board. */
  chartsOnly?: boolean;
  /** Tiles can also be dragged onto the dashboard canvas, landing where they're dropped. */
  draggable?: boolean;
  /** Only the heading and story starters (the blocks live in the Add panel). */
  hideBlocks?: boolean;
};

/** Blocks that only exist on a dashboard (layout, content, filters). */
const BOARD_ONLY_TYPES = new Set(['text', 'divider', 'image', 'embed', 'slicer', 'filter']);

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
  draggable = false,
}: {
  item: WidgetTemplate & { bestFor?: string };
  variant: WidgetBlockPickerVariant;
  onSelect: (template: WidgetTemplate) => void;
  bestForLabel: string;
  draggable?: boolean;
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
        draggable={draggable}
        onDragStart={draggable ? (e) => startCanvasDrag(e, { kind: 'block', type: item.type, w: item.defaultSize?.w ?? 6, h: item.defaultSize?.h ?? 5 }) : undefined}
        onDragEnd={draggable ? endCanvasDrag : undefined}
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

export function WidgetBlockPicker({
  variant = 'canvas',
  onSelect,
  onApplyStoryStarter,
  search = '',
  hintText,
  title,
  chartsOnly = false,
  draggable = false,
  hideBlocks = false,
}: Props) {
  const t = useTranslations('dashboards_page');
  const tc = useTranslations('chart_designer');
  const [expanded, setExpanded] = useState(false);

  const normalizedSearch = search.trim().toLowerCase();

  const allTemplates = useMemo(
    () => WIDGET_TEMPLATES
      .filter((item) => !chartsOnly || !BOARD_ONLY_TYPES.has(item.type))
      .map((item) => localizeWidgetTemplate(item, tc as never)),
    [tc, chartsOnly],
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

  const showExpanded = expanded || chartsOnly || Boolean(normalizedSearch);
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
                  draggable={draggable}
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
                  draggable={draggable}
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
      {title !== null ? (
        <>
          <Text strong className="!block !mb-1.5 text-lg text-text">
            {title ?? t('empty_state_title')}
          </Text>
          <Text type="secondary" className="!block !mb-5 text-sm opacity-85 leading-relaxed">
            {hintText ?? t('empty_state_hint')}
          </Text>
        </>
      ) : null}
      {onApplyStoryStarter && !normalizedSearch ? (
        <Text type="secondary" className="!block !mb-4 text-xs">
          <Link href="/chart-designer" className="text-brand hover:underline">
            {t('open_chart_library')}
          </Link>
        </Text>
      ) : null}

      {onApplyStoryStarter && !normalizedSearch ? (
        <div className="mb-6 text-left">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mb-2 text-center">
            {t('story_starters_label')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STORY_STARTERS.map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="rounded-md border border-border-light bg-bg-container px-3 py-2.5 text-left transition-colors hover:border-brand hover:bg-brand-subtle focus-visible:border-brand focus-visible:outline-none"
                onClick={() => onApplyStoryStarter(starter.id)}
              >
                <div className="text-sm font-semibold text-text">{t(starter.titleKey)}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-text-secondary">
                  {t(starter.descKey)}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* The short list, until "Show all" — then every block once, by section (not both). */}
      {!showExpanded && !hideBlocks ? (
        <>
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
        </>
      ) : null}

      {!normalizedSearch && !showExpanded && !hideBlocks ? (
        <div className="mt-4">
          <Button type="default" icon={<DownOutlined />} onClick={() => setExpanded(true)}>
            {t('blocks_show_all')}
          </Button>
        </div>
      ) : null}

      {showExpanded && !hideBlocks &&
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
                  draggable={draggable}
                />
              ))}
            </div>
          </div>
        ))}

      {!normalizedSearch && showExpanded && !chartsOnly ? (
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
