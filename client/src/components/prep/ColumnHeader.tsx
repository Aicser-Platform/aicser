'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Dropdown, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import {
  CalendarOutlined,
  CheckSquareOutlined,
  DollarOutlined,
  DownOutlined,
  FieldNumberOutlined,
  FieldTimeOutlined,
  FontSizeOutlined,
  NumberOutlined,
  QuestionOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import type { ColumnDistribution, ColumnMeaning } from '@/api/prep';
import { friendlyType } from './recipeSteps';

const { Text } = Typography;

const TYPE_ICON: Record<string, React.ReactNode> = {
  text: <FontSizeOutlined />,
  integer: <NumberOutlined />,
  number: <FieldNumberOutlined />,
  decimal: <DollarOutlined />,
  boolean: <CheckSquareOutlined />,
  date: <CalendarOutlined />,
  datetime: <FieldTimeOutlined />,
  other: <QuestionOutlined />,
};

function MiniChart({ dist }: { dist: ColumnDistribution }) {
  if (dist.histogram?.length) {
    const max = Math.max(...dist.histogram.map((b) => b.count), 1);
    return (
      <svg className="recipe-col__chart" viewBox="0 0 120 22" preserveAspectRatio="none" aria-hidden="true">
        {dist.histogram.map((b, i) => {
          const h = Math.max(1, (b.count / max) * 20);
          return <rect key={i} x={i * 10 + 1} y={22 - h} width={8} height={h} rx={1} />;
        })}
      </svg>
    );
  }
  const top = (dist.top ?? []).slice(0, 3);
  const max = Math.max(...top.map((x) => x.count), 1);
  return (
    <div className="recipe-col__top" aria-hidden="true">
      {top.map((x) => (
        <div key={x.value} className="recipe-col__top-row">
          <span className="recipe-col__top-bar" style={{ width: `${(x.count / max) * 100}%` }} />
          <span className="recipe-col__top-label">{x.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Column header: type in plain words, a data-quality bar, and the shape of the values. */
export function ColumnHeader({
  name,
  engineType,
  dist,
  selected,
  isNew,
  meaning,
  readOnly,
  menu,
  onSelect,
}: {
  name: string;
  engineType: string;
  dist?: ColumnDistribution;
  selected: boolean;
  isNew: boolean;
  /** What the column means, when someone described it. */
  meaning?: ColumnMeaning;
  readOnly: boolean;
  menu: MenuProps['items'];
  onSelect: (additive: boolean) => void;
}) {
  const t = useTranslations('prepare');
  const tr = useTranslations('column_roles');
  const kind = friendlyType(engineType);
  // A category keeps its storage type; the icon shows how it is used.
  const asCategory = meaning?.role === 'category';
  const filled = dist ? dist.rows - dist.empty : 0;
  const filledPct = dist && dist.rows ? (filled / dist.rows) * 100 : 0;

  return (
    <div className={`recipe-col${selected ? ' is-selected' : ''}${isNew ? ' is-new' : ''}`}>
      <div className="recipe-col__title">
        <Tooltip title={asCategory ? `${t(`type_${kind}`)} · ${tr('role_category')}` : t(`type_${kind}`)}>
          <span className="recipe-col__type" aria-label={t(`type_${kind}`)}>{asCategory ? <TagsOutlined /> : TYPE_ICON[kind]}</span>
        </Tooltip>
        <button
          type="button"
          className="recipe-col__name"
          onClick={(e) => onSelect(e.shiftKey || e.metaKey || e.ctrlKey)}
          aria-pressed={selected}
          title={t('select_column_hint')}
        >
          <Text strong ellipsis>{name}</Text>
        </button>
        {isNew ? <span className="recipe-col__new">{t('new_badge')}</span> : null}
        {meaning && (meaning.description || meaning.role || meaning.personal) ? (
          <Tooltip
            title={[meaning.description, meaning.role ? tr(`role_${meaning.role}`) : null, meaning.personal ? t('meaning_personal_short') : null]
              .filter(Boolean)
              .join(' · ')}
          >
            <span className={`recipe-col__meaning${meaning.personal ? ' is-personal' : ''}`} aria-label={t('action_meaning')} />
          </Tooltip>
        ) : null}
        {!readOnly ? (
          <Dropdown menu={{ items: menu }} trigger={['click']}>
            <button type="button" className="recipe-col__menu" aria-label={t('column_menu', { column: name })}>
              <DownOutlined />
            </button>
          </Dropdown>
        ) : null}
      </div>
      {dist ? (
        <Tooltip title={t('quality_tooltip', { filled, empty: dist.empty, distinct: dist.distinct })}>
          <div className="recipe-col__quality" role="img" aria-label={t('quality_tooltip', { filled, empty: dist.empty, distinct: dist.distinct })}>
            <span className="recipe-col__quality-filled" style={{ width: `${filledPct}%` }} />
          </div>
        </Tooltip>
      ) : (
        <div className="recipe-col__quality recipe-col__quality--loading" />
      )}
      {dist ? <MiniChart dist={dist} /> : <div className="recipe-col__chart-placeholder" />}
    </div>
  );
}
