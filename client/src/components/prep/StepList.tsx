'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button, Space, Tag, Tooltip, Typography } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  DatabaseOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  RedoOutlined,
  UndoOutlined,
  OrderedListOutlined,
} from '@ant-design/icons';
import { SidePanel } from '@/components/layout/SidePanel';
import type { PrepStep, StepStat } from '@/api/prep';
import { isDisabled, stepSentence } from './stepText';

const { Text } = Typography;

export function StepList({
  steps,
  table,
  selected,
  stats,
  errorAt,
  readOnly,
  canUndo,
  canRedo,
  onSelect,
  onEdit,
  onToggle,
  onMove,
  onRemove,
  onUndo,
  onRedo,
  onShowFailures,
}: {
  steps: PrepStep[];
  table: string;
  selected: number | null;
  stats: StepStat[];
  errorAt: (i: number) => string | undefined;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSelect: (i: number | null) => void;
  onEdit: (i: number) => void;
  onToggle: (i: number) => void;
  onMove: (i: number, delta: -1 | 1) => void;
  onRemove: (i: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onShowFailures: (step: number, column: string) => void;
}) {
  const t = useTranslations('prepare');
  const tt = t as unknown as (k: string, v?: Record<string, string | number>) => string;
  const statFor = (i: number) => stats.find((s) => s.step === i);

  return (
    <SidePanel
      id="prepare.steps"
      side="left"
      title={t('applied_steps')}
      icon={<OrderedListOutlined />}
      count={steps.length}
      className="recipe-editor__steps"
      extra={!readOnly ? (
        <Space size={0}>
          <Tooltip title={t('undo')}>
            <Button size="small" type="text" icon={<UndoOutlined />} aria-label={t('undo')} disabled={!canUndo} onClick={onUndo} />
          </Tooltip>
          <Tooltip title={t('redo')}>
            <Button size="small" type="text" icon={<RedoOutlined />} aria-label={t('redo')} disabled={!canRedo} onClick={onRedo} />
          </Tooltip>
        </Space>
      ) : null}
    >
      <ol className="recipe-editor__step-list">
        <li>
          <button type="button" className={`recipe-editor__step${selected === -1 ? ' is-selected' : ''}`} onClick={() => onSelect(-1)}>
            <DatabaseOutlined /> <span>{t('step_source', { table })}</span>
          </button>
        </li>
        {steps.map((step, i) => {
          const err = errorAt(i);
          const active = selected === i || (selected === null && i === steps.length - 1);
          const off = isDisabled(step);
          const stat = statFor(i);
          return (
            <li key={i} className={`recipe-editor__step-row${active ? ' is-selected' : ''}${err ? ' has-error' : ''}${off ? ' is-off' : ''}`}>
              <button type="button" className="recipe-editor__step" onClick={() => onSelect(i)} title={stepSentence(step, tt)}>
                {err ? <ExclamationCircleOutlined className="recipe-editor__err-icon" /> : <span className="recipe-editor__num">{i + 1}</span>}
                <span className="recipe-editor__step-text">{stepSentence(step, tt)}</span>
              </button>
              {stat && !off ? (
                <div className="recipe-editor__step-stats">
                  {stat.rows_delta ? <Tag color="orange">{t('stat_rows', { delta: stat.rows_delta })}</Tag> : null}
                  {stat.added?.length ? <Tag color="green">{t('stat_added', { count: stat.added.length })}</Tag> : null}
                  {Object.entries(stat.emptied ?? {}).map(([col, n]) => (
                    <Tag key={col} color="red" className="recipe-editor__clickable" onClick={() => onShowFailures(i, col)}>
                      {t('stat_emptied', { count: n, column: col })}
                    </Tag>
                  ))}
                </div>
              ) : null}
              {!readOnly ? (
                <Space size={0} className="recipe-editor__step-actions">
                  <Button size="small" type="text" icon={<EditOutlined />} aria-label={t('edit_step')} onClick={() => onEdit(i)} />
                  <Button size="small" type="text" icon={off ? <EyeInvisibleOutlined /> : <EyeOutlined />} aria-label={off ? t('turn_on') : t('turn_off')} onClick={() => onToggle(i)} />
                  <Button size="small" type="text" icon={<ArrowUpOutlined />} aria-label={t('move_up')} onClick={() => onMove(i, -1)} disabled={i === 0} />
                  <Button size="small" type="text" icon={<ArrowDownOutlined />} aria-label={t('move_down')} onClick={() => onMove(i, 1)} disabled={i === steps.length - 1} />
                  <Button size="small" type="text" icon={<CloseOutlined />} aria-label={t('remove_step')} onClick={() => onRemove(i)} />
                </Space>
              ) : null}
            </li>
          );
        })}
      </ol>
      {steps.length === 0 ? <Text type="secondary" className="recipe-editor__hint">{t('no_steps_hint')}</Text> : null}
    </SidePanel>
  );
}
